import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { parse } from "../lib/validate";
import { userId, clearAuthCookie } from "../middleware/auth";
import { badRequest, notFound } from "../lib/errors";
import { templateSchema, dateSchema } from "../services/schemas";
import { applyOperations } from "../services/operations";
import { computeStats } from "../services/stats";
import { materialize } from "../services/recurrence";
import { addDays, todayLocal, weekStart, monthStart, monthEnd, daysBetween } from "../../shared/time";
import { runAssistant } from "../ai/assistant";
import { weeklyReview } from "../ai/review";
import { usageSummary } from "../ai/usage";
import { aiEnabled, config } from "../config";
import type { ProposalDTO } from "../../shared/types";

/* ---------------- Şablonlar ---------------- */

export const templatesRouter = Router();

templatesRouter.get("/", async (req, res) => {
  const templates = await prisma.template.findMany({ where: { userId: userId(req) }, orderBy: { createdAt: "desc" } });
  res.json({ templates });
});

templatesRouter.post("/", async (req, res) => {
  const uid = userId(req);
  const data = parse(templateSchema, req.body);
  const from = data.kind === "DAY" ? data.sourceDate : weekStart(data.sourceDate);
  const to = data.kind === "DAY" ? data.sourceDate : addDays(from, 6);
  await materialize(uid, from, to);
  const tasks = await prisma.task.findMany({ where: { userId: uid, date: { gte: from, lte: to }, status: { in: ["PLANNED", "DONE"] } } });
  const payload = tasks.map((t) => ({
    dayOffset: daysBetween(from, t.date),
    title: t.title,
    notes: t.notes,
    categoryId: t.categoryId,
    startTime: t.startTime,
    durationMinutes: t.durationMinutes,
    priority: t.priority,
    timeType: t.timeType,
    flexibility: t.flexibility,
    difficulty: t.difficulty,
  }));
  if (payload.length === 0) throw badRequest("Seçilen aralıkta görev yok.");
  const template = await prisma.template.create({ data: { userId: uid, name: data.name, kind: data.kind, payload: payload as unknown as Prisma.InputJsonValue } });
  res.status(201).json({ template });
});

templatesRouter.post("/:id/apply", async (req, res) => {
  const uid = userId(req);
  const t = await prisma.template.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!t) throw notFound("Şablon");
  const { targetDate } = parse(z.object({ targetDate: dateSchema }), req.body);
  const base = t.kind === "DAY" ? targetDate : weekStart(targetDate);
  const items = t.payload as unknown as Array<Record<string, unknown> & { dayOffset: number }>;
  const ops = items.map((it) => ({
    type: "create" as const,
    task: {
      title: String(it.title),
      notes: (it.notes as string | null) ?? null,
      categoryId: (it.categoryId as string | null) ?? null,
      date: addDays(base, it.dayOffset),
      startTime: (it.startTime as string | null) ?? null,
      durationMinutes: Number(it.durationMinutes ?? 30),
      priority: it.priority as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      timeType: it.timeType as "FIXED" | "FLEXIBLE" | "PRIORITY" | "OPTIONAL" | "REST",
      flexibility: Number(it.flexibility ?? 1),
      difficulty: Number(it.difficulty ?? 2),
    },
  }));
  const r = await applyOperations(uid, ops, { description: `"${t.name}" şablonu uygulandı (${targetDate})` });
  res.json({ applied: ops.length, changeSetId: r.changeSetId });
});

templatesRouter.delete("/:id", async (req, res) => {
  await prisma.template.deleteMany({ where: { id: req.params.id as string, userId: userId(req) } });
  res.json({ ok: true });
});

/* ---------------- İstatistik ---------------- */

export const statsRouter = Router();

statsRouter.get("/", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const today = todayLocal();
  let from: string;
  let to: string;
  if (q.range === "month") {
    from = monthStart(q.date ?? today);
    to = monthEnd(q.date ?? today);
  } else if (q.range === "day") {
    from = to = parse(dateSchema, q.date ?? today);
  } else if (q.from && q.to) {
    from = parse(dateSchema, q.from);
    to = parse(dateSchema, q.to);
  } else {
    from = weekStart(q.date ?? today);
    to = addDays(from, 6);
  }
  await materialize(userId(req), from, to);
  res.json(await computeStats(userId(req), from, to));
});

/* ---------------- Veri: dışa/içe aktarma, silme ---------------- */

export const dataRouter = Router();

async function exportAll(uid: string) {
  const [user, settings, categories, tasks, recurrences, habits, goals, notes, templates, sleepLogs] = await Promise.all([
    prisma.user.findUnique({ where: { id: uid }, select: { id: true, name: true, email: true, createdAt: true } }),
    prisma.userSettings.findUnique({ where: { userId: uid } }),
    prisma.category.findMany({ where: { userId: uid } }),
    prisma.task.findMany({ where: { userId: uid } }),
    prisma.recurrence.findMany({ where: { userId: uid } }),
    prisma.habit.findMany({ where: { userId: uid }, include: { logs: true } }),
    prisma.goal.findMany({ where: { userId: uid }, include: { milestones: true } }),
    prisma.learningNote.findMany({ where: { userId: uid } }),
    prisma.template.findMany({ where: { userId: uid } }),
    prisma.sleepLog.findMany({ where: { userId: uid } }),
  ]);
  return { exportedAt: new Date().toISOString(), version: 1, user, settings, categories, tasks, recurrences, habits, goals, notes, templates, sleepLogs };
}

dataRouter.get("/export.json", async (req, res) => {
  const data = await exportAll(userId(req));
  res.setHeader("Content-Disposition", `attachment; filename="lifeflow-yedek-${todayLocal()}.json"`);
  res.json(data);
});

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

dataRouter.get("/export.csv", async (req, res) => {
  const uid = userId(req);
  const [tasks, cats] = await Promise.all([prisma.task.findMany({ where: { userId: uid }, orderBy: [{ date: "asc" }, { startTime: "asc" }] }), prisma.category.findMany({ where: { userId: uid } })]);
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const header = ["id", "tarih", "baslangic", "bitis", "sure_dk", "baslik", "kategori", "oncelik", "zaman_turu", "esneklik", "durum", "son_tarih", "zorluk", "erteleme", "notlar"];
  const rows = tasks.map((t) => [t.id, t.date, t.startTime, t.endTime, t.durationMinutes, t.title, t.categoryId ? catName.get(t.categoryId) : "", t.priority, t.timeType, t.flexibility, t.status, t.deadline, t.difficulty, t.postponeCount, t.notes].map(csvEscape).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="lifeflow-gorevler-${todayLocal()}.csv"`);
  res.send("﻿" + [header.join(","), ...rows].join("\n"));
});

/** JSON yedeğinden görevleri/kategorileri/alışkanlıkları içe aktar (mevcutların üstüne ekler). */
dataRouter.post("/import", async (req, res) => {
  const uid = userId(req);
  const body = req.body as { categories?: unknown[]; tasks?: unknown[]; habits?: unknown[]; goals?: unknown[]; notes?: unknown[] };
  if (!body || typeof body !== "object") throw badRequest("Geçersiz yedek dosyası.");
  const catIdMap = new Map<string, string>();
  const existingCats = await prisma.category.findMany({ where: { userId: uid } });
  for (const c of (body.categories ?? []) as Array<{ id: string; name: string; color?: string; icon?: string; weeklyTargetMinutes?: number }>) {
    const found = existingCats.find((e) => e.name === c.name);
    if (found) catIdMap.set(c.id, found.id);
    else {
      const created = await prisma.category.create({ data: { userId: uid, name: c.name, color: c.color ?? "#6366f1", icon: c.icon ?? "circle", weeklyTargetMinutes: c.weeklyTargetMinutes ?? 0 } });
      catIdMap.set(c.id, created.id);
    }
  }
  let tasks = 0;
  for (const t of (body.tasks ?? []) as Array<Record<string, unknown>>) {
    if (typeof t.title !== "string" || typeof t.date !== "string") continue;
    await prisma.task.create({
      data: {
        userId: uid,
        title: t.title,
        notes: (t.notes as string | null) ?? null,
        categoryId: t.categoryId ? catIdMap.get(String(t.categoryId)) ?? null : null,
        date: t.date,
        startTime: (t.startTime as string | null) ?? null,
        endTime: (t.endTime as string | null) ?? null,
        durationMinutes: Number(t.durationMinutes ?? 30),
        priority: (t.priority as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL") ?? "MEDIUM",
        timeType: (t.timeType as "FIXED" | "FLEXIBLE" | "PRIORITY" | "OPTIONAL" | "REST") ?? "FLEXIBLE",
        flexibility: Number(t.flexibility ?? 1),
        deadline: (t.deadline as string | null) ?? null,
        status: (t.status as "PLANNED" | "DONE" | "SKIPPED" | "CANCELLED" | "FAILED" | "POSTPONED") ?? "PLANNED",
        difficulty: Number(t.difficulty ?? 2),
        postponeCount: Number(t.postponeCount ?? 0),
      },
    });
    tasks++;
  }
  let habits = 0;
  for (const h of (body.habits ?? []) as Array<Record<string, unknown> & { logs?: Array<Record<string, unknown>> }>) {
    if (typeof h.name !== "string") continue;
    const created = await prisma.habit.create({
      data: {
        userId: uid,
        name: h.name,
        icon: (h.icon as string) ?? "check",
        frequency: (h.frequency as "DAILY" | "WEEKLY") ?? "DAILY",
        weekdays: Array.isArray(h.weekdays) ? (h.weekdays as number[]) : [0, 1, 2, 3, 4, 5, 6],
        dailyTarget: Number(h.dailyTarget ?? 1),
        weeklyTarget: Number(h.weeklyTarget ?? 7),
        categoryId: h.categoryId ? catIdMap.get(String(h.categoryId)) ?? null : null,
      },
    });
    for (const l of h.logs ?? []) {
      if (typeof l.date !== "string") continue;
      await prisma.habitLog.upsert({
        where: { habitId_date: { habitId: created.id, date: l.date } },
        create: { habitId: created.id, date: l.date, status: (l.status as "DONE" | "SKIPPED" | "POSTPONED") ?? "DONE", value: Number(l.value ?? 1) },
        update: {},
      });
    }
    habits++;
  }
  res.json({ imported: { tasks, habits, categories: catIdMap.size } });
});

dataRouter.delete("/account", async (req, res) => {
  const uid = userId(req);
  const { confirm } = parse(z.object({ confirm: z.literal("SİL") }), req.body);
  void confirm;
  await prisma.user.delete({ where: { id: uid } });
  clearAuthCookie(res);
  res.json({ ok: true });
});

/* ---------------- AI ---------------- */

export const aiRouter = Router();

aiRouter.get("/status", async (req, res) => {
  res.json({ enabled: aiEnabled(), model: config.anthropicModel, usage: await usageSummary(userId(req)) });
});

const chatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(40).default([]),
});

aiRouter.post("/chat", async (req, res) => {
  const data = parse(chatSchema, req.body);
  const result = await runAssistant(userId(req), data.history, data.message);
  res.json(result);
});

function toProposalDTO(p: { id: string; summary: string; rationale: string; operations: unknown; preview: unknown; status: string; createdAt: Date }): ProposalDTO {
  const preview = (p.preview as { lines?: ProposalDTO["preview"]; warnings?: string[] }) ?? {};
  return {
    id: p.id,
    summary: p.summary,
    rationale: p.rationale,
    operations: p.operations as ProposalDTO["operations"],
    preview: preview.lines ?? [],
    warnings: preview.warnings ?? [],
    status: p.status as ProposalDTO["status"],
    createdAt: p.createdAt.toISOString(),
  };
}

aiRouter.get("/proposals", async (req, res) => {
  const items = await prisma.aiProposal.findMany({ where: { userId: userId(req), status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 10 });
  res.json({ proposals: items.map(toProposalDTO) });
});

aiRouter.post("/proposals/:id/apply", async (req, res) => {
  const uid = userId(req);
  const p = await prisma.aiProposal.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!p) throw notFound("Öneri");
  if (p.status !== "PENDING") throw badRequest("Bu öneri zaten sonuçlanmış.");
  const r = await applyOperations(uid, p.operations, { description: `AI: ${p.summary}`, source: "AI" });
  await prisma.aiProposal.update({ where: { id: p.id }, data: { status: "APPLIED", resolvedAt: new Date() } });
  res.json({ ...r, proposal: toProposalDTO({ ...p, status: "APPLIED" }) });
});

aiRouter.post("/proposals/:id/reject", async (req, res) => {
  const uid = userId(req);
  const p = await prisma.aiProposal.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!p) throw notFound("Öneri");
  await prisma.aiProposal.update({ where: { id: p.id }, data: { status: "REJECTED", resolvedAt: new Date() } });
  res.json({ ok: true });
});

aiRouter.post("/weekly-review", async (req, res) => {
  const { date, force } = parse(z.object({ date: dateSchema.optional(), force: z.boolean().optional() }), req.body ?? {});
  res.json(await weeklyReview(userId(req), date, force));
});

aiRouter.get("/weekly-review", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const ws = weekStart(q.date ?? todayLocal());
  const cached = await prisma.weeklyReview.findUnique({ where: { userId_weekStart: { userId: userId(req), weekStart: ws } } });
  res.json(cached ? { weekStart: ws, weekEnd: addDays(ws, 6), content: cached.content, stats: cached.stats, cached: true } : null);
});
