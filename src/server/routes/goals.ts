import { Router } from "express";
import { prisma } from "../db";
import { parse } from "../lib/validate";
import { userId } from "../middleware/auth";
import { notFound } from "../lib/errors";
import { goalSchema, milestoneSchema, noteSchema } from "../services/schemas";
import { z } from "zod";
import { LEARNING_AREAS } from "../../shared/defaults";

export const goalsRouter = Router();

async function ownGoal(uid: string, id: string) {
  const g = await prisma.goal.findFirst({ where: { id, userId: uid } });
  if (!g) throw notFound("Hedef");
  return g;
}

goalsRouter.get("/areas", (_req, res) => {
  res.json({ areas: LEARNING_AREAS });
});

goalsRouter.get("/", async (req, res) => {
  const goals = await prisma.goal.findMany({
    where: { userId: userId(req) },
    include: { milestones: { orderBy: { sortOrder: "asc" } }, _count: { select: { notes: true, tasks: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const withProgress = await Promise.all(
    goals.map(async (g) => {
      const doneTasks = await prisma.task.aggregate({ where: { goalId: g.id, status: "DONE" }, _sum: { durationMinutes: true }, _count: true });
      const total = g.milestones.length;
      const done = g.milestones.filter((m) => m.done).length;
      return { ...g, progress: total ? Math.round((done / total) * 100) : g.status === "COMPLETED" ? 100 : 0, minutesDone: doneTasks._sum.durationMinutes ?? 0, tasksDone: doneTasks._count };
    }),
  );
  res.json({ goals: withProgress });
});

goalsRouter.post("/", async (req, res) => {
  const uid = userId(req);
  const { milestones, ...data } = parse(goalSchema, req.body);
  const goal = await prisma.goal.create({
    data: {
      ...data,
      userId: uid,
      milestones: milestones?.length ? { create: milestones.map((title, i) => ({ title, sortOrder: i })) } : undefined,
    },
    include: { milestones: { orderBy: { sortOrder: "asc" } } },
  });
  res.status(201).json({ goal });
});

goalsRouter.patch("/:id", async (req, res) => {
  const uid = userId(req);
  const g = await ownGoal(uid, req.params.id as string);
  const { milestones, ...data } = parse(goalSchema.partial(), req.body);
  const goal = await prisma.goal.update({ where: { id: g.id }, data, include: { milestones: { orderBy: { sortOrder: "asc" } } } });
  void milestones;
  res.json({ goal });
});

goalsRouter.delete("/:id", async (req, res) => {
  const uid = userId(req);
  const g = await ownGoal(uid, req.params.id as string);
  await prisma.goal.delete({ where: { id: g.id } });
  res.json({ ok: true });
});

goalsRouter.post("/:id/milestones", async (req, res) => {
  const uid = userId(req);
  const g = await ownGoal(uid, req.params.id as string);
  const data = parse(z.object({ title: z.string().trim().min(1).max(200) }), req.body);
  const count = await prisma.milestone.count({ where: { goalId: g.id } });
  const milestone = await prisma.milestone.create({ data: { goalId: g.id, title: data.title, sortOrder: count } });
  res.status(201).json({ milestone });
});

goalsRouter.patch("/:id/milestones/:mid", async (req, res) => {
  const uid = userId(req);
  const g = await ownGoal(uid, req.params.id as string);
  const data = parse(milestoneSchema, req.body);
  const m = await prisma.milestone.findFirst({ where: { id: req.params.mid as string, goalId: g.id } });
  if (!m) throw notFound("Aşama");
  const milestone = await prisma.milestone.update({
    where: { id: m.id },
    data: { ...data, doneAt: data.done === true ? new Date() : data.done === false ? null : undefined },
  });
  // Tüm aşamalar bittiyse hedefi tamamla
  const remaining = await prisma.milestone.count({ where: { goalId: g.id, done: false } });
  const total = await prisma.milestone.count({ where: { goalId: g.id } });
  if (total > 0 && remaining === 0 && g.status === "ACTIVE") await prisma.goal.update({ where: { id: g.id }, data: { status: "COMPLETED" } });
  if (remaining > 0 && g.status === "COMPLETED") await prisma.goal.update({ where: { id: g.id }, data: { status: "ACTIVE" } });
  res.json({ milestone });
});

goalsRouter.delete("/:id/milestones/:mid", async (req, res) => {
  const uid = userId(req);
  const g = await ownGoal(uid, req.params.id as string);
  await prisma.milestone.deleteMany({ where: { id: req.params.mid as string, goalId: g.id } });
  res.json({ ok: true });
});

export const notesRouter = Router();

notesRouter.get("/", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const notes = await prisma.learningNote.findMany({
    where: { userId: userId(req), ...(q.goalId ? { goalId: q.goalId } : {}), ...(q.kind ? { kind: q.kind } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  res.json({ notes });
});

notesRouter.post("/", async (req, res) => {
  const uid = userId(req);
  const data = parse(noteSchema, req.body);
  if (data.goalId) await ownGoal(uid, data.goalId);
  const note = await prisma.learningNote.create({ data: { ...data, userId: uid } });
  res.status(201).json({ note });
});

notesRouter.patch("/:id", async (req, res) => {
  const uid = userId(req);
  const existing = await prisma.learningNote.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!existing) throw notFound("Not");
  const data = parse(noteSchema.partial(), req.body);
  const note = await prisma.learningNote.update({ where: { id: existing.id }, data });
  res.json({ note });
});

notesRouter.delete("/:id", async (req, res) => {
  const uid = userId(req);
  await prisma.learningNote.deleteMany({ where: { id: req.params.id as string, userId: uid } });
  res.json({ ok: true });
});
