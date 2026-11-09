// Doğrulanmış operasyonlar: önizleme, uygulama (işlem içinde), geri al / yeniden uygula.
// AI ve yeniden planlama motoru veritabanına yalnızca bu katmandan ulaşır.

import type { Prisma, Task } from "@prisma/client";
import { prisma } from "../db";
import { badRequest, notFound } from "../lib/errors";
import { parse } from "../lib/validate";
import { operationsSchema } from "./schemas";
import { endTimeOf } from "./recurrence";
import { detectConflicts, type PlannerTask } from "../planner/slots";
import { formatDateTR } from "../../shared/time";
import type { Operation, PreviewLine, TaskInput, TaskPatch } from "../../shared/types";
import { STATUS_LABELS } from "../../shared/types";

type Tx = Prisma.TransactionClient;

/** Dahili operasyon: create için id (geri al/yeniden uygula) taşıyabilir. */
export type InternalOp =
  | { type: "create"; task: TaskInput; reason?: string; id?: string }
  | { type: "update"; taskId: string; changes: TaskPatch; reason?: string }
  | { type: "delete"; taskId: string; reason?: string };

const SCHEDULE_FIELDS = ["date", "startTime", "durationMinutes", "title", "categoryId", "priority", "timeType", "notes"] as const;

export function toPlannerTask(t: Task): PlannerTask {
  return {
    id: t.id,
    title: t.title,
    date: t.date,
    startTime: t.startTime,
    durationMinutes: t.durationMinutes,
    priority: t.priority,
    timeType: t.timeType,
    flexibility: t.flexibility,
    deadline: t.deadline,
    status: t.status,
    categoryId: t.categoryId,
    difficulty: t.difficulty,
    postponeCount: t.postponeCount,
    goalId: t.goalId,
    notes: t.notes,
    recurrenceId: t.recurrenceId,
  };
}

function taskCreateData(userId: string, input: TaskInput, id?: string): Prisma.TaskUncheckedCreateInput {
  const duration = input.durationMinutes ?? 30;
  return {
    ...(id ? { id } : {}),
    userId,
    title: input.title,
    notes: input.notes ?? null,
    categoryId: input.categoryId ?? null,
    date: input.date,
    startTime: input.startTime ?? null,
    endTime: endTimeOf(input.startTime ?? null, duration),
    durationMinutes: duration,
    priority: input.priority ?? "MEDIUM",
    timeType: input.timeType ?? "FLEXIBLE",
    flexibility: input.flexibility ?? (input.timeType === "FIXED" ? 0 : 1),
    deadline: input.deadline ?? null,
    difficulty: input.difficulty ?? 2,
    goalId: input.goalId ?? null,
  };
}

function describe(t: Pick<Task, "date" | "startTime" | "durationMinutes" | "status">): string {
  const time = t.startTime ? ` ${t.startTime}` : " (saatsiz)";
  const status = t.status !== "PLANNED" ? ` [${STATUS_LABELS[t.status]}]` : "";
  return `${formatDateTR(t.date)}${time}, ${t.durationMinutes} dk${status}`;
}

async function ensureOwnership(userId: string, ops: InternalOp[], db: Tx | typeof prisma = prisma) {
  const ids = ops.flatMap((o) => (o.type === "create" ? [] : [o.taskId]));
  const tasks = ids.length ? await db.task.findMany({ where: { id: { in: ids }, userId } }) : [];
  const map = new Map(tasks.map((t) => [t.id, t]));
  for (const id of ids) if (!map.has(id)) throw notFound(`Görev (${id})`);
  const catIds = ops.flatMap((o) => {
    const c = o.type === "create" ? o.task.categoryId : o.type === "update" ? o.changes.categoryId : null;
    return c ? [c] : [];
  });
  if (catIds.length) {
    const cats = await db.category.findMany({ where: { id: { in: catIds }, userId }, select: { id: true } });
    const have = new Set(cats.map((c) => c.id));
    for (const c of catIds) if (!have.has(c)) throw badRequest(`Kategori bulunamadı: ${c}`);
  }
  const goalIds = ops.flatMap((o) => {
    const g = o.type === "create" ? o.task.goalId : o.type === "update" ? o.changes.goalId : null;
    return g ? [g] : [];
  });
  if (goalIds.length) {
    const goals = await db.goal.findMany({ where: { id: { in: goalIds }, userId }, select: { id: true } });
    const have = new Set(goals.map((g) => g.id));
    for (const g of goalIds) if (!have.has(g)) throw badRequest(`Hedef bulunamadı: ${g}`);
  }
  return map;
}

export interface ValidationResult {
  operations: InternalOp[];
  preview: PreviewLine[];
  warnings: string[];
  affectedDates: string[];
}

/** Operasyonları doğrular, önizleme üretir ve oluşacak çakışmaları bulur. */
export async function validateOperations(userId: string, rawOps: unknown): Promise<ValidationResult> {
  const ops = parse(operationsSchema, rawOps) as InternalOp[];
  const existing = await ensureOwnership(userId, ops);
  const preview: PreviewLine[] = [];
  const warnings: string[] = [];
  const dates = new Set<string>();

  for (const op of ops) {
    if (op.type === "create") {
      dates.add(op.task.date);
      preview.push({
        kind: "create",
        title: op.task.title,
        after: describe({ date: op.task.date, startTime: op.task.startTime ?? null, durationMinutes: op.task.durationMinutes ?? 30, status: "PLANNED" }),
        reason: op.reason,
      });
    } else if (op.type === "update") {
      const before = existing.get(op.taskId)!;
      const after = { ...before, ...op.changes } as Task;
      dates.add(before.date);
      dates.add(after.date);
      const line: PreviewLine = {
        kind: "update",
        taskId: op.taskId,
        title: before.title,
        before: describe(before),
        after: describe(after),
        reason: op.reason,
      };
      if (before.timeType === "FIXED" && (op.changes.date || op.changes.startTime)) {
        line.warning = "Sabit görev taşınıyor.";
      }
      if (before.status === "DONE" && op.changes.status && op.changes.status !== "DONE") {
        line.warning = "Tamamlanmış bir görevin durumu değiştiriliyor.";
      }
      if (op.changes.title && op.changes.title !== before.title) line.after += ` → "${op.changes.title}"`;
      preview.push(line);
    } else {
      const before = existing.get(op.taskId)!;
      dates.add(before.date);
      preview.push({
        kind: "delete",
        taskId: op.taskId,
        title: before.title,
        before: describe(before),
        reason: op.reason,
        warning: before.status === "DONE" ? "Tamamlanmış görev siliniyor (geçmiş kaybolur)." : undefined,
      });
    }
  }

  // Çakışma simülasyonu
  const affectedDates = [...dates];
  if (affectedDates.length) {
    const dayTasks = await prisma.task.findMany({ where: { userId, date: { in: affectedDates } } });
    const beforeConflicts = new Set(detectConflicts(dayTasks.map(toPlannerTask)).map((c) => [c.a.id, c.b.id].sort().join("|")));
    const sim = new Map(dayTasks.map((t) => [t.id, toPlannerTask(t)]));
    let tmp = 0;
    for (const op of ops) {
      if (op.type === "create") {
        const id = op.id ?? `__new${tmp++}`;
        sim.set(id, toPlannerTask({ ...taskCreateData(userId, op.task, id), id, status: "PLANNED", postponeCount: 0, completedAt: null, recurrenceId: null, seriesDate: null, detached: false, createdAt: new Date(), updatedAt: new Date() } as Task));
      } else if (op.type === "update") {
        const cur = sim.get(op.taskId) ?? toPlannerTask(existing.get(op.taskId)!);
        sim.set(op.taskId, { ...cur, ...(op.changes as Partial<PlannerTask>) });
      } else sim.delete(op.taskId);
    }
    const after = detectConflicts([...sim.values()]);
    for (const c of after) {
      const key = [c.a.id, c.b.id].sort().join("|");
      if (beforeConflicts.has(key)) continue;
      warnings.push(`Çakışma: "${c.a.title}" ile "${c.b.title}" ${formatDateTR(c.a.date, false)} günü ${c.overlapMinutes} dk üst üste biniyor.`);
    }
  }
  return { operations: ops, preview, warnings, affectedDates };
}

/** Operasyonları işlem içinde uygular; ters operasyonları döndürür. */
async function executeOps(tx: Tx, userId: string, ops: InternalOp[]): Promise<{ forward: InternalOp[]; inverse: InternalOp[] }> {
  const forward: InternalOp[] = [];
  const inverse: InternalOp[] = [];
  for (const op of ops) {
    if (op.type === "create") {
      const created = await tx.task.create({ data: taskCreateData(userId, op.task, op.id) });
      forward.push({ ...op, id: created.id });
      inverse.push({ type: "delete", taskId: created.id });
    } else if (op.type === "update") {
      const before = await tx.task.findFirst({ where: { id: op.taskId, userId } });
      if (!before) throw notFound(`Görev (${op.taskId})`);
      const data: Prisma.TaskUncheckedUpdateInput = { ...op.changes };
      const duration = op.changes.durationMinutes ?? before.durationMinutes;
      const start = op.changes.startTime === undefined ? before.startTime : op.changes.startTime;
      data.endTime = endTimeOf(start, duration);
      if (op.changes.status === "DONE" && before.status !== "DONE") data.completedAt = new Date();
      if (op.changes.status && op.changes.status !== "DONE") data.completedAt = null;
      if (before.recurrenceId && SCHEDULE_FIELDS.some((f) => f in op.changes && (op.changes as Record<string, unknown>)[f] !== (before as Record<string, unknown>)[f])) {
        data.detached = true;
      }
      const after = await tx.task.update({ where: { id: op.taskId }, data });
      const beforeVals: Record<string, unknown> = {};
      for (const key of Object.keys(op.changes)) beforeVals[key] = (before as Record<string, unknown>)[key];
      forward.push(op);
      inverse.push({ type: "update", taskId: op.taskId, changes: beforeVals as TaskPatch });
      void after;
    } else {
      const before = await tx.task.findFirst({ where: { id: op.taskId, userId } });
      if (!before) throw notFound(`Görev (${op.taskId})`);
      await tx.task.delete({ where: { id: op.taskId } });
      forward.push(op);
      inverse.push({
        type: "create",
        id: before.id,
        task: {
          title: before.title,
          notes: before.notes,
          categoryId: before.categoryId,
          date: before.date,
          startTime: before.startTime,
          durationMinutes: before.durationMinutes,
          priority: before.priority,
          timeType: before.timeType,
          flexibility: before.flexibility,
          deadline: before.deadline,
          difficulty: before.difficulty,
          goalId: before.goalId,
        },
      });
    }
  }
  return { forward, inverse: inverse.reverse() };
}

export interface ApplyOptions {
  description: string;
  source?: "USER" | "AI" | "SYSTEM";
}

/** Operasyonları uygular ve değişiklik geçmişine kaydeder. */
export async function applyOperations(userId: string, rawOps: unknown, opts: ApplyOptions) {
  const ops = parse(operationsSchema, rawOps) as InternalOp[];
  await ensureOwnership(userId, ops);
  return prisma.$transaction(async (tx) => {
    const { forward, inverse } = await executeOps(tx, userId, ops);
    const changeSet = await tx.changeSet.create({
      data: {
        userId,
        description: opts.description,
        source: opts.source ?? "USER",
        forward: forward as unknown as Prisma.InputJsonValue,
        inverse: inverse as unknown as Prisma.InputJsonValue,
      },
    });
    return { changeSetId: changeSet.id, applied: forward.length };
  });
}

export async function undoLast(userId: string) {
  const cs = await prisma.changeSet.findFirst({ where: { userId, undone: false }, orderBy: { createdAt: "desc" } });
  if (!cs) throw badRequest("Geri alınacak değişiklik yok.");
  await prisma.$transaction(async (tx) => {
    await executeOps(tx, userId, cs.inverse as unknown as InternalOp[]);
    await tx.changeSet.update({ where: { id: cs.id }, data: { undone: true } });
  });
  return { id: cs.id, description: cs.description };
}

export async function redoLast(userId: string) {
  const cs = await prisma.changeSet.findFirst({ where: { userId, undone: true }, orderBy: { createdAt: "desc" } });
  if (!cs) throw badRequest("Yeniden uygulanacak değişiklik yok.");
  // Yalnızca en son geri alınan ve kendisinden sonra yeni değişiklik yapılmamışsa
  const newer = await prisma.changeSet.count({ where: { userId, undone: false, createdAt: { gt: cs.createdAt } } });
  if (newer > 0) throw badRequest("Daha yeni değişiklikler olduğu için yeniden uygulanamaz.");
  await prisma.$transaction(async (tx) => {
    await executeOps(tx, userId, cs.forward as unknown as InternalOp[]);
    await tx.changeSet.update({ where: { id: cs.id }, data: { undone: false } });
  });
  return { id: cs.id, description: cs.description };
}

export type { Operation };
