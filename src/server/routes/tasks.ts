import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { parse } from "../lib/validate";
import { userId } from "../middleware/auth";
import { notFound, badRequest } from "../lib/errors";
import { taskInputSchema, taskPatchSchema, dateSchema, recurrenceInputSchema } from "../services/schemas";
import { applyOperations, validateOperations, undoLast, redoLast, toPlannerTask } from "../services/operations";
import { materialize, syncSeries, endTimeOf } from "../services/recurrence";
import { runScenario, freeSlotsFor } from "../services/planner";
import { detectConflicts } from "../planner/slots";
import { addDays, todayLocal, weekStart } from "../../shared/time";

export const tasksRouter = Router();

const rangeSchema = z.object({ from: dateSchema, to: dateSchema });

tasksRouter.get("/", async (req, res) => {
  const uid = userId(req);
  const q = req.query as Record<string, string | undefined>;
  if (q.backlog === "1") {
    const today = todayLocal();
    const tasks = await prisma.task.findMany({ where: { userId: uid, date: { lt: today }, status: { in: ["PLANNED", "POSTPONED"] } }, orderBy: [{ date: "asc" }, { startTime: "asc" }] });
    return res.json({ tasks });
  }
  const { from, to } = parse(rangeSchema, { from: q.from ?? todayLocal(), to: q.to ?? q.from ?? todayLocal() });
  if (to < from) throw badRequest("Bitiş tarihi başlangıçtan önce olamaz.");
  await materialize(uid, from, to);
  const tasks = await prisma.task.findMany({ where: { userId: uid, date: { gte: from, lte: to } }, orderBy: [{ date: "asc" }, { startTime: "asc" }] });
  const conflicts = detectConflicts(tasks.map(toPlannerTask)).map((c) => ({ a: c.a.id, b: c.b.id, overlapMinutes: c.overlapMinutes }));
  res.json({ tasks, conflicts });
});

tasksRouter.post("/", async (req, res) => {
  const uid = userId(req);
  const input = parse(taskInputSchema, req.body);
  const r = await applyOperations(uid, [{ type: "create", task: input }], { description: `"${input.title}" oluşturuldu` });
  const created = await prisma.task.findFirst({ where: { userId: uid }, orderBy: { createdAt: "desc" } });
  res.status(201).json({ task: created, changeSetId: r.changeSetId });
});

tasksRouter.get("/:id", async (req, res) => {
  const task = await prisma.task.findFirst({ where: { id: req.params.id as string, userId: userId(req) } });
  if (!task) throw notFound("Görev");
  res.json({ task });
});

tasksRouter.patch("/:id", async (req, res) => {
  const uid = userId(req);
  const id = req.params.id as string;
  const changes = parse(taskPatchSchema, req.body);
  const before = await prisma.task.findFirst({ where: { id, userId: uid } });
  if (!before) throw notFound("Görev");
  const label = changes.status ? `"${before.title}" durumu ${changes.status}` : `"${before.title}" güncellendi`;
  const r = await applyOperations(uid, [{ type: "update", taskId: id, changes }], { description: label });
  const task = await prisma.task.findUnique({ where: { id } });
  res.json({ task, changeSetId: r.changeSetId });
});

tasksRouter.delete("/:id", async (req, res) => {
  const uid = userId(req);
  const id = req.params.id as string;
  const before = await prisma.task.findFirst({ where: { id, userId: uid } });
  if (!before) throw notFound("Görev");
  const r = await applyOperations(uid, [{ type: "delete", taskId: id }], { description: `"${before.title}" silindi` });
  res.json({ ok: true, changeSetId: r.changeSetId });
});

/** Günü / haftayı başka tarihe kopyala */
tasksRouter.post("/copy", async (req, res) => {
  const uid = userId(req);
  const data = parse(z.object({ kind: z.enum(["DAY", "WEEK"]), sourceDate: dateSchema, targetDate: dateSchema, includeFixed: z.boolean().optional() }), req.body);
  const srcFrom = data.kind === "DAY" ? data.sourceDate : weekStart(data.sourceDate);
  const srcTo = data.kind === "DAY" ? data.sourceDate : addDays(srcFrom, 6);
  const dstFrom = data.kind === "DAY" ? data.targetDate : weekStart(data.targetDate);
  await materialize(uid, srcFrom, srcTo);
  const source = await prisma.task.findMany({ where: { userId: uid, date: { gte: srcFrom, lte: srcTo }, status: { in: ["PLANNED", "DONE"] } } });
  const ops = source
    .filter((t) => !t.recurrenceId && (data.includeFixed !== false || t.timeType !== "FIXED"))
    .map((t) => ({
      type: "create" as const,
      task: {
        title: t.title,
        notes: t.notes,
        categoryId: t.categoryId,
        date: addDays(dstFrom, Math.round((new Date(t.date).getTime() - new Date(srcFrom).getTime()) / 86400000)),
        startTime: t.startTime,
        durationMinutes: t.durationMinutes,
        priority: t.priority,
        timeType: t.timeType,
        flexibility: t.flexibility,
        difficulty: t.difficulty,
        goalId: t.goalId,
      },
    }));
  if (ops.length === 0) return res.json({ copied: 0 });
  const r = await applyOperations(uid, ops, { description: `${data.kind === "DAY" ? "Gün" : "Hafta"} kopyalandı (${data.sourceDate} → ${data.targetDate})` });
  res.json({ copied: ops.length, changeSetId: r.changeSetId });
});

/* ---------------- Operasyonlar (önizleme / uygulama / geri al) ---------------- */

export const operationsRouter = Router();

operationsRouter.post("/preview", async (req, res) => {
  const v = await validateOperations(userId(req), req.body?.operations);
  res.json({ preview: v.preview, warnings: v.warnings, affectedDates: v.affectedDates });
});

operationsRouter.post("/apply", async (req, res) => {
  const uid = userId(req);
  const description = typeof req.body?.description === "string" && req.body.description.trim() ? req.body.description.slice(0, 200) : "Toplu değişiklik";
  const r = await applyOperations(uid, req.body?.operations, { description, source: req.body?.source === "AI" ? "AI" : "USER" });
  res.json(r);
});

operationsRouter.post("/undo", async (req, res) => {
  res.json(await undoLast(userId(req)));
});

operationsRouter.post("/redo", async (req, res) => {
  res.json(await redoLast(userId(req)));
});

operationsRouter.get("/history", async (req, res) => {
  const items = await prisma.changeSet.findMany({
    where: { userId: userId(req) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, description: true, source: true, undone: true, createdAt: true },
  });
  res.json({ history: items });
});

/* ---------------- Yeniden planlama ---------------- */

export const replanRouter = Router();

replanRouter.post("/", async (req, res) => {
  const outcome = await runScenario(userId(req), req.body);
  res.json({
    operations: outcome.operations,
    explanation: outcome.explanation,
    warnings: outcome.warnings,
    affected: outcome.affected.map((a) => ({ id: a.id, title: a.title, date: a.date, startTime: a.startTime })),
    preview: outcome.preview,
  });
});

replanRouter.get("/free-slots", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const date = parse(dateSchema, q.date ?? todayLocal());
  res.json(await freeSlotsFor(userId(req), date, q.duration ? Number(q.duration) : undefined));
});

/* ---------------- Tekrarlayan görevler ---------------- */

export const recurrencesRouter = Router();

recurrencesRouter.get("/", async (req, res) => {
  const recurrences = await prisma.recurrence.findMany({ where: { userId: userId(req) }, orderBy: { createdAt: "desc" } });
  res.json({ recurrences });
});

recurrencesRouter.post("/", async (req, res) => {
  const uid = userId(req);
  const data = parse(recurrenceInputSchema, req.body);
  if (data.frequency === "WEEKLY" && data.weekdays.length === 0) throw badRequest("Haftalık tekrar için en az bir gün seçin.");
  const rec = await prisma.recurrence.create({ data: { ...data, userId: uid } });
  await materialize(uid, rec.startDate, addDays(todayLocal(), 35));
  res.status(201).json({ recurrence: rec });
});

/** Seriyi güncelle: gelecekteki ayrılmamış örnekler senkronlanır. */
recurrencesRouter.patch("/:id", async (req, res) => {
  const uid = userId(req);
  const existing = await prisma.recurrence.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!existing) throw notFound("Tekrar");
  const parsed = parse(recurrenceInputSchema.partial(), req.body);
  // partial() varsayılanları uygulayabilir; yalnızca gönderilen alanları güncelle
  const data = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in (req.body ?? {}))) as typeof parsed;
  if (data.frequency === "WEEKLY" && data.weekdays && data.weekdays.length === 0) throw badRequest("Haftalık tekrar için en az bir gün seçin.");
  const rec = await prisma.recurrence.update({ where: { id: existing.id }, data });
  const from = (req.body?.fromDate as string) || todayLocal();
  await syncSeries(rec, from);
  await materialize(uid, from, addDays(todayLocal(), 35));
  res.json({ recurrence: rec });
});

/** Seriyi sonlandır: gelecek planlı örnekler silinir, geçmiş kayıtlar korunur. */
recurrencesRouter.delete("/:id", async (req, res) => {
  const uid = userId(req);
  const existing = await prisma.recurrence.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!existing) throw notFound("Tekrar");
  const today = todayLocal();
  await prisma.$transaction([
    prisma.task.deleteMany({ where: { recurrenceId: existing.id, status: "PLANNED", date: { gte: today }, detached: false } }),
    prisma.task.updateMany({ where: { recurrenceId: existing.id }, data: { detached: true } }),
    prisma.recurrence.update({ where: { id: existing.id }, data: { active: false, endDate: addDays(today, -1) } }),
  ]);
  res.json({ ok: true });
});

export { endTimeOf };
