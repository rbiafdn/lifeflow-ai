// Doğrulanmış operasyonlar: önizleme, uygulama, geri al / yeniden uygula.
// AI ve yeniden planlama motoru veriye yalnızca bu katmandan ulaşır.

import { db, save, newId, nowIso, badRequest, notFound, type TaskRec } from "./db";
import { parse } from "./validate";
import { operationsSchema } from "./schemas";
import { endTimeOf } from "./recurrence";
import { detectConflicts, type PlannerTask } from "../shared/planner/slots";
import { formatDateTR } from "../shared/time";
import type { PreviewLine, TaskInput, TaskPatch } from "../shared/types";
import { STATUS_LABELS } from "../shared/types";

export type InternalOp =
  | { type: "create"; task: TaskInput; reason?: string; id?: string }
  | { type: "update"; taskId: string; changes: TaskPatch; reason?: string }
  | { type: "delete"; taskId: string; reason?: string };

const SCHEDULE_FIELDS = ["date", "startTime", "durationMinutes", "title", "categoryId", "priority", "timeType", "notes"] as const;

export function toPlannerTask(t: TaskRec): PlannerTask {
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

export function buildTask(input: TaskInput, id?: string): TaskRec {
  const duration = input.durationMinutes ?? 30;
  const ts = nowIso();
  return {
    id: id ?? newId(),
    userId: "local",
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
    status: "PLANNED",
    difficulty: input.difficulty ?? 2,
    postponeCount: 0,
    completedAt: null,
    recurrenceId: null,
    seriesDate: null,
    detached: false,
    goalId: input.goalId ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
}

function describe(t: Pick<TaskRec, "date" | "startTime" | "durationMinutes" | "status">): string {
  const time = t.startTime ? ` ${t.startTime}` : " (saatsiz)";
  const status = t.status !== "PLANNED" ? ` [${STATUS_LABELS[t.status]}]` : "";
  return `${formatDateTR(t.date)}${time}, ${t.durationMinutes} dk${status}`;
}

function ensureRefs(ops: InternalOp[]): Map<string, TaskRec> {
  const d = db();
  const map = new Map<string, TaskRec>();
  for (const op of ops) {
    if (op.type === "create") continue;
    const t = d.tasks.find((x) => x.id === op.taskId);
    if (!t) throw notFound(`Görev (${op.taskId})`);
    map.set(t.id, t);
  }
  const catIds = ops.flatMap((o) => {
    const c = o.type === "create" ? o.task.categoryId : o.type === "update" ? o.changes.categoryId : null;
    return c ? [c] : [];
  });
  for (const c of catIds) if (!d.categories.some((x) => x.id === c)) throw badRequest(`Kategori bulunamadı: ${c}`);
  const goalIds = ops.flatMap((o) => {
    const g = o.type === "create" ? o.task.goalId : o.type === "update" ? o.changes.goalId : null;
    return g ? [g] : [];
  });
  for (const g of goalIds) if (!d.goals.some((x) => x.id === g)) throw badRequest(`Hedef bulunamadı: ${g}`);
  return map;
}

export interface ValidationResult {
  operations: InternalOp[];
  preview: PreviewLine[];
  warnings: string[];
  affectedDates: string[];
}

export function validateOperations(rawOps: unknown): ValidationResult {
  const ops = parse(operationsSchema, rawOps) as InternalOp[];
  const existing = ensureRefs(ops);
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
      const after = { ...before, ...op.changes } as TaskRec;
      dates.add(before.date);
      dates.add(after.date);
      const line: PreviewLine = { kind: "update", taskId: op.taskId, title: before.title, before: describe(before), after: describe(after), reason: op.reason };
      if (before.timeType === "FIXED" && (op.changes.date || op.changes.startTime)) line.warning = "Sabit görev taşınıyor.";
      if (before.status === "DONE" && op.changes.status && op.changes.status !== "DONE") line.warning = "Tamamlanmış bir görevin durumu değiştiriliyor.";
      if (op.changes.title && op.changes.title !== before.title) line.after += ` → "${op.changes.title}"`;
      preview.push(line);
    } else {
      const before = existing.get(op.taskId)!;
      dates.add(before.date);
      preview.push({ kind: "delete", taskId: op.taskId, title: before.title, before: describe(before), reason: op.reason, warning: before.status === "DONE" ? "Tamamlanmış görev siliniyor (geçmiş kaybolur)." : undefined });
    }
  }

  const affectedDates = [...dates];
  if (affectedDates.length) {
    const dayTasks = db().tasks.filter((t) => dates.has(t.date));
    const beforeConflicts = new Set(detectConflicts(dayTasks.map(toPlannerTask)).map((c) => [c.a.id, c.b.id].sort().join("|")));
    const sim = new Map(dayTasks.map((t) => [t.id, toPlannerTask(t)]));
    let tmp = 0;
    for (const op of ops) {
      if (op.type === "create") {
        const id = op.id ?? `__new${tmp++}`;
        sim.set(id, toPlannerTask(buildTask(op.task, id)));
      } else if (op.type === "update") {
        const cur = sim.get(op.taskId) ?? toPlannerTask(existing.get(op.taskId)!);
        sim.set(op.taskId, { ...cur, ...(op.changes as Partial<PlannerTask>) });
      } else sim.delete(op.taskId);
    }
    for (const c of detectConflicts([...sim.values()])) {
      const key = [c.a.id, c.b.id].sort().join("|");
      if (beforeConflicts.has(key)) continue;
      warnings.push(`Çakışma: "${c.a.title}" ile "${c.b.title}" ${formatDateTR(c.a.date, false)} günü ${c.overlapMinutes} dk üst üste biniyor.`);
    }
  }
  return { operations: ops, preview, warnings, affectedDates };
}

function executeOps(ops: InternalOp[]): { forward: InternalOp[]; inverse: InternalOp[] } {
  const d = db();
  const forward: InternalOp[] = [];
  const inverse: InternalOp[] = [];
  for (const op of ops) {
    if (op.type === "create") {
      const created = buildTask(op.task, op.id);
      d.tasks.push(created);
      forward.push({ ...op, id: created.id });
      inverse.push({ type: "delete", taskId: created.id });
    } else if (op.type === "update") {
      const before = d.tasks.find((x) => x.id === op.taskId);
      if (!before) throw notFound(`Görev (${op.taskId})`);
      const beforeVals: Record<string, unknown> = {};
      for (const key of Object.keys(op.changes)) beforeVals[key] = (before as unknown as Record<string, unknown>)[key];
      const duration = op.changes.durationMinutes ?? before.durationMinutes;
      const start = op.changes.startTime === undefined ? before.startTime : op.changes.startTime;
      const detach = !!before.recurrenceId && SCHEDULE_FIELDS.some((f) => f in op.changes && (op.changes as Record<string, unknown>)[f] !== (before as unknown as Record<string, unknown>)[f]);
      Object.assign(before, op.changes, { endTime: endTimeOf(start, duration), updatedAt: nowIso() });
      if (op.changes.status === "DONE" && beforeVals.status !== "DONE") before.completedAt = nowIso();
      if (op.changes.status && op.changes.status !== "DONE") before.completedAt = null;
      if (detach) before.detached = true;
      forward.push(op);
      inverse.push({ type: "update", taskId: op.taskId, changes: beforeVals as TaskPatch });
    } else {
      const idx = d.tasks.findIndex((x) => x.id === op.taskId);
      if (idx === -1) throw notFound(`Görev (${op.taskId})`);
      const before = d.tasks[idx];
      d.tasks.splice(idx, 1);
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

/** Operasyonları uygular ve değişiklik geçmişine kaydeder. Hata olursa hiçbir şey değişmez. */
export function applyOperations(rawOps: unknown, opts: ApplyOptions) {
  const ops = parse(operationsSchema, rawOps) as InternalOp[];
  ensureRefs(ops);
  const d = db();
  const snapshot = JSON.stringify(d.tasks);
  try {
    const { forward, inverse } = executeOps(ops);
    const cs = { id: newId(), description: opts.description, source: opts.source ?? "USER", forward, inverse, undone: false, createdAt: nowIso() } as const;
    // Yeni değişiklik, geri alınmış olanların "yeniden uygula" zincirini kırar
    d.changeSets = d.changeSets.filter((c) => !c.undone);
    d.changeSets.push({ ...cs });
    save();
    return { changeSetId: cs.id, applied: forward.length };
  } catch (e) {
    d.tasks = JSON.parse(snapshot);
    throw e;
  }
}

export function undoLast() {
  const d = db();
  const cs = [...d.changeSets].reverse().find((c) => !c.undone);
  if (!cs) throw badRequest("Geri alınacak değişiklik yok.");
  executeOps(cs.inverse as InternalOp[]);
  cs.undone = true;
  save();
  return { id: cs.id, description: cs.description };
}

export function redoLast() {
  const d = db();
  const cs = d.changeSets.find((c) => c.undone);
  if (!cs) throw badRequest("Yeniden uygulanacak değişiklik yok.");
  executeOps(cs.forward as InternalOp[]);
  cs.undone = false;
  save();
  return { id: cs.id, description: cs.description };
}

export function history(limit = 50) {
  return [...db().changeSets]
    .reverse()
    .slice(0, limit)
    .map((c) => ({ id: c.id, description: c.description, source: c.source, undone: c.undone, createdAt: c.createdAt }));
}
