import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { parse } from "../lib/validate";
import { userId } from "../middleware/auth";
import { notFound } from "../lib/errors";
import { habitSchema, habitLogSchema, dateSchema } from "../services/schemas";
import { addDays, todayLocal, weekday, weekStart } from "../../shared/time";

export const habitsRouter = Router();

habitsRouter.get("/", async (req, res) => {
  const uid = userId(req);
  const q = req.query as Record<string, string | undefined>;
  const to = parse(dateSchema, q.to ?? todayLocal());
  const from = parse(dateSchema, q.from ?? addDays(to, -27));
  const habits = await prisma.habit.findMany({
    where: { userId: uid, ...(q.all === "1" ? {} : { active: true }) },
    include: { logs: { where: { date: { gte: from, lte: to } }, orderBy: { date: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  // Seri hesapları (tüm geçmiş)
  const allLogs = await prisma.habitLog.findMany({ where: { habit: { userId: uid }, status: "DONE" }, select: { habitId: true, date: true } });
  const doneByHabit = new Map<string, Set<string>>();
  for (const l of allLogs) {
    if (!doneByHabit.has(l.habitId)) doneByHabit.set(l.habitId, new Set());
    doneByHabit.get(l.habitId)!.add(l.date);
  }
  const today = todayLocal();
  const result = habits.map((h) => {
    const done = doneByHabit.get(h.id) ?? new Set<string>();
    let streak = 0;
    let best = 0;
    // mevcut seri: bugünden geriye; bugün henüz yapılmadıysa dünden başla
    let cursor = done.has(today) ? today : addDays(today, -1);
    for (let i = 0; i < 1000; i++) {
      const relevant = h.frequency !== "DAILY" || h.weekdays.includes(weekday(cursor));
      if (relevant) {
        if (done.has(cursor)) streak++;
        else break;
      }
      cursor = addDays(cursor, -1);
    }
    // en iyi seri
    const sorted = [...done].sort();
    let run = 0;
    let prev: string | null = null;
    for (const d of sorted) {
      run = prev && addDays(prev, 1) === d ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    }
    const ws = weekStart(today);
    const weekDone = [...done].filter((d) => d >= ws && d <= addDays(ws, 6)).length;
    return { ...h, streak, bestStreak: best, weekDone, totalDone: done.size };
  });
  res.json({ habits: result, from, to });
});

habitsRouter.post("/", async (req, res) => {
  const uid = userId(req);
  const data = parse(habitSchema, req.body);
  const habit = await prisma.habit.create({ data: { ...data, userId: uid } });
  res.status(201).json({ habit });
});

habitsRouter.patch("/:id", async (req, res) => {
  const uid = userId(req);
  const existing = await prisma.habit.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!existing) throw notFound("Alışkanlık");
  const data = parse(habitSchema.partial(), req.body);
  const habit = await prisma.habit.update({ where: { id: existing.id }, data: { ...data, archivedAt: data.active === false ? new Date() : data.active === true ? null : undefined } });
  res.json({ habit });
});

habitsRouter.delete("/:id", async (req, res) => {
  const uid = userId(req);
  const existing = await prisma.habit.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!existing) throw notFound("Alışkanlık");
  // Geçmiş korunur: arşivle
  await prisma.habit.update({ where: { id: existing.id }, data: { active: false, archivedAt: new Date() } });
  res.json({ ok: true });
});

/** Günlük kayıt: tamamlandı / atlandı / ertelendi (aynı gün için günceller) */
habitsRouter.post("/:id/log", async (req, res) => {
  const uid = userId(req);
  const existing = await prisma.habit.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!existing) throw notFound("Alışkanlık");
  const data = parse(habitLogSchema, req.body);
  const log = await prisma.habitLog.upsert({
    where: { habitId_date: { habitId: existing.id, date: data.date } },
    create: { habitId: existing.id, date: data.date, status: data.status, value: data.value ?? 1, note: data.note ?? null },
    update: { status: data.status, value: data.value ?? 1, note: data.note ?? null },
  });
  res.json({ log });
});

habitsRouter.delete("/:id/log/:date", async (req, res) => {
  const uid = userId(req);
  const existing = await prisma.habit.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!existing) throw notFound("Alışkanlık");
  const date = parse(dateSchema, req.params.date);
  await prisma.habitLog.deleteMany({ where: { habitId: existing.id, date } });
  res.json({ ok: true });
});

export const sleepRouter = Router();

sleepRouter.get("/", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const to = parse(dateSchema, q.to ?? todayLocal());
  const from = parse(dateSchema, q.from ?? addDays(to, -29));
  const logs = await prisma.sleepLog.findMany({ where: { userId: userId(req), date: { gte: from, lte: to } }, orderBy: { date: "asc" } });
  res.json({ logs });
});

sleepRouter.post("/", async (req, res) => {
  const uid = userId(req);
  const data = parse(z.object({ date: dateSchema, bedTime: z.string(), wakeTime: z.string(), quality: z.number().int().min(1).max(5).optional() }), req.body);
  const [bh, bm] = data.bedTime.split(":").map(Number);
  const [wh, wm] = data.wakeTime.split(":").map(Number);
  let minutes = wh * 60 + wm - (bh * 60 + bm);
  if (minutes <= 0) minutes += 24 * 60;
  const log = await prisma.sleepLog.upsert({
    where: { userId_date: { userId: uid, date: data.date } },
    create: { userId: uid, date: data.date, bedTime: data.bedTime, wakeTime: data.wakeTime, minutes, quality: data.quality ?? 3 },
    update: { bedTime: data.bedTime, wakeTime: data.wakeTime, minutes, quality: data.quality ?? 3 },
  });
  res.json({ log });
});
