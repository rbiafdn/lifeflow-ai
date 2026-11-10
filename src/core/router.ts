// Tarayıcı içi "API": istemcinin kullandığı /api/... yolları çekirdek fonksiyonlara eşlenir.
// Böylece arayüz bileşenleri sunucu varmış gibi çalışır; veri bu cihazda kalır.

import { z } from "zod";
import { db, save, newId, nowIso, resetDatabase, replaceDatabase, emptyDatabase, CoreError, badRequest, notFound, type Database, type HabitRec } from "./db";
import { parse } from "./validate";
import { taskInputSchema, taskPatchSchema, dateSchema, recurrenceInputSchema, settingsSchema, categorySchema, habitSchema, habitLogSchema, goalSchema, milestoneSchema, noteSchema, templateSchema } from "./schemas";
import { applyOperations, validateOperations, undoLast, redoLast, history, toPlannerTask } from "./operations";
import { materialize, syncSeries } from "./recurrence";
import { runScenario, freeSlotsFor } from "./planner";
import { computeStats } from "./stats";
import { detectConflicts } from "../shared/planner/slots";
import { addDays, todayLocal, weekStart, monthStart, monthEnd, daysBetween, weekday } from "../shared/time";
import { LEARNING_AREAS } from "../shared/defaults";
import { runAssistant, toProposalDTO } from "./ai/assistant";
import { weeklyReview, cachedReview } from "./ai/review";
import { aiEnabled, usageSummary } from "./ai/usage";
import { MODEL } from "./ai/client";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Handler = (p: Record<string, string>, q: URLSearchParams, body: unknown) => unknown;
interface Route {
  method: Method;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];
function on(method: Method, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, pattern, keys, handler });
}

export async function handle(method: Method, url: string, body?: unknown): Promise<unknown> {
  const [path, qs = ""] = url.split("?");
  const q = new URLSearchParams(qs);
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return await r.handler(params, q, body);
  }
  throw new CoreError(404, `Uç nokta bulunamadı: ${method} ${path}`);
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const obj = (b: unknown) => (b && typeof b === "object" ? (b as Record<string, unknown>) : {});

/* ---------------- Profil ---------------- */
on("GET", "/api/health", () => ({ ok: true, ai: aiEnabled(), model: MODEL(), time: nowIso() }));
on("GET", "/api/auth/me", () => ({ user: { id: "local", name: db().profile.name, email: "" } }));
on("POST", "/api/auth/logout", () => ({ ok: true }));
on("PATCH", "/api/auth/me", (_p, _q, body) => {
  const data = parse(z.object({ name: z.string().trim().min(1).max(80).optional() }), body);
  if (data.name) db().profile.name = data.name;
  save();
  return { user: { id: "local", name: db().profile.name, email: "" } };
});

/* ---------------- Ayarlar ve kategoriler ---------------- */
on("GET", "/api/settings", () => ({ settings: db().settings }));
on("PUT", "/api/settings", (_p, _q, body) => {
  const data = parse(settingsSchema, body);
  Object.assign(db().settings, data);
  save();
  return { settings: db().settings };
});
on("GET", "/api/categories", () => ({ categories: [...db().categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)) }));
on("POST", "/api/categories", (_p, _q, body) => {
  const data = parse(categorySchema, body);
  const d = db();
  if (d.categories.some((c) => c.name === data.name)) throw badRequest("Bu isimde bir kategori zaten var.");
  const category = { id: newId(), name: data.name, color: data.color ?? "#6366f1", icon: data.icon ?? "circle", isDefault: false, weeklyTargetMinutes: data.weeklyTargetMinutes ?? 0, sortOrder: data.sortOrder ?? d.categories.length };
  d.categories.push(category);
  save();
  return { category };
});
on("PATCH", "/api/categories/:id", (p, _q, body) => {
  const data = parse(categorySchema.partial(), body);
  const c = db().categories.find((x) => x.id === p.id);
  if (!c) throw notFound("Kategori");
  if (data.name && db().categories.some((x) => x.id !== c.id && x.name === data.name)) throw badRequest("Bu isimde bir kategori zaten var.");
  Object.assign(c, data);
  save();
  return { category: c };
});
on("DELETE", "/api/categories/:id", (p) => {
  const d = db();
  if (!d.categories.some((x) => x.id === p.id)) throw notFound("Kategori");
  d.categories = d.categories.filter((x) => x.id !== p.id);
  for (const t of d.tasks) if (t.categoryId === p.id) t.categoryId = null;
  for (const r of d.recurrences) if (r.categoryId === p.id) r.categoryId = null;
  for (const h of d.habits) if (h.categoryId === p.id) h.categoryId = null;
  for (const g of d.goals) if (g.categoryId === p.id) g.categoryId = null;
  save();
  return { ok: true };
});

/* ---------------- Görevler ---------------- */
const sortTasks = <T extends { date: string; startTime: string | null }>(list: T[]) => [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "99").localeCompare(b.startTime ?? "99"));

on("GET", "/api/tasks", (_p, q) => {
  const d = db();
  const today = todayLocal();
  if (q.get("backlog") === "1") return { tasks: sortTasks(d.tasks.filter((t) => t.date < today && (t.status === "PLANNED" || t.status === "POSTPONED"))) };
  const { from, to } = parse(z.object({ from: dateSchema, to: dateSchema }), { from: q.get("from") ?? today, to: q.get("to") ?? q.get("from") ?? today });
  if (to < from) throw badRequest("Bitiş tarihi başlangıçtan önce olamaz.");
  materialize(from, to);
  const tasks = sortTasks(d.tasks.filter((t) => t.date >= from && t.date <= to));
  const conflicts = detectConflicts(tasks.map(toPlannerTask)).map((c) => ({ a: c.a.id, b: c.b.id, overlapMinutes: c.overlapMinutes }));
  return { tasks, conflicts };
});
on("POST", "/api/tasks", (_p, _q, body) => {
  const input = parse(taskInputSchema, body);
  const r = applyOperations([{ type: "create", task: input }], { description: `"${input.title}" oluşturuldu` });
  const created = db().tasks[db().tasks.length - 1];
  return { task: created, changeSetId: r.changeSetId };
});
on("POST", "/api/tasks/copy", (_p, _q, body) => {
  const data = parse(z.object({ kind: z.enum(["DAY", "WEEK"]), sourceDate: dateSchema, targetDate: dateSchema, includeFixed: z.boolean().optional() }), body);
  const srcFrom = data.kind === "DAY" ? data.sourceDate : weekStart(data.sourceDate);
  const srcTo = data.kind === "DAY" ? data.sourceDate : addDays(srcFrom, 6);
  const dstFrom = data.kind === "DAY" ? data.targetDate : weekStart(data.targetDate);
  materialize(srcFrom, srcTo);
  const ops = db()
    .tasks.filter((t) => t.date >= srcFrom && t.date <= srcTo && (t.status === "PLANNED" || t.status === "DONE") && !t.recurrenceId && (data.includeFixed !== false || t.timeType !== "FIXED"))
    .map((t) => ({
      type: "create" as const,
      task: { title: t.title, notes: t.notes, categoryId: t.categoryId, date: addDays(dstFrom, daysBetween(srcFrom, t.date)), startTime: t.startTime, durationMinutes: t.durationMinutes, priority: t.priority, timeType: t.timeType, flexibility: t.flexibility, difficulty: t.difficulty, goalId: t.goalId },
    }));
  if (ops.length === 0) return { copied: 0 };
  const r = applyOperations(ops, { description: `${data.kind === "DAY" ? "Gün" : "Hafta"} kopyalandı (${data.sourceDate} → ${data.targetDate})` });
  return { copied: ops.length, changeSetId: r.changeSetId };
});
on("GET", "/api/tasks/:id", (p) => {
  const task = db().tasks.find((t) => t.id === p.id);
  if (!task) throw notFound("Görev");
  return { task };
});
on("PATCH", "/api/tasks/:id", (p, _q, body) => {
  const changes = parse(taskPatchSchema, body);
  const before = db().tasks.find((t) => t.id === p.id);
  if (!before) throw notFound("Görev");
  const label = changes.status ? `"${before.title}" durumu ${changes.status}` : `"${before.title}" güncellendi`;
  const r = applyOperations([{ type: "update", taskId: p.id, changes }], { description: label });
  return { task: db().tasks.find((t) => t.id === p.id), changeSetId: r.changeSetId };
});
on("DELETE", "/api/tasks/:id", (p) => {
  const before = db().tasks.find((t) => t.id === p.id);
  if (!before) throw notFound("Görev");
  const r = applyOperations([{ type: "delete", taskId: p.id }], { description: `"${before.title}" silindi` });
  return { ok: true, changeSetId: r.changeSetId };
});

/* ---------------- Operasyonlar ---------------- */
on("POST", "/api/operations/preview", (_p, _q, body) => {
  const v = validateOperations(obj(body).operations);
  return { preview: v.preview, warnings: v.warnings, affectedDates: v.affectedDates };
});
on("POST", "/api/operations/apply", (_p, _q, body) => {
  const b = obj(body);
  const description = typeof b.description === "string" && b.description.trim() ? b.description.slice(0, 200) : "Toplu değişiklik";
  return applyOperations(b.operations, { description, source: b.source === "AI" ? "AI" : "USER" });
});
on("POST", "/api/operations/undo", () => undoLast());
on("POST", "/api/operations/redo", () => redoLast());
on("GET", "/api/operations/history", () => ({ history: history() }));

/* ---------------- Yeniden planlama ---------------- */
on("POST", "/api/replan", (_p, _q, body) => {
  const o = runScenario(body);
  return { operations: o.operations, explanation: o.explanation, warnings: o.warnings, affected: o.affected.map((a) => ({ id: a.id, title: a.title, date: a.date, startTime: a.startTime })), preview: o.preview };
});
on("GET", "/api/replan/free-slots", (_p, q) => freeSlotsFor(parse(dateSchema, q.get("date") ?? todayLocal()), q.get("duration") ? Number(q.get("duration")) : undefined));

/* ---------------- Tekrarlar ---------------- */
on("GET", "/api/recurrences", () => ({ recurrences: [...db().recurrences].reverse() }));
on("POST", "/api/recurrences", (_p, _q, body) => {
  const data = parse(recurrenceInputSchema, body);
  if (data.frequency === "WEEKLY" && data.weekdays.length === 0) throw badRequest("Haftalık tekrar için en az bir gün seçin.");
  const ts = nowIso();
  const rec = { id: newId(), ...data, notes: data.notes ?? null, categoryId: data.categoryId ?? null, startTime: data.startTime ?? null, endDate: data.endDate ?? null, active: data.active ?? true, createdAt: ts, updatedAt: ts };
  db().recurrences.push(rec);
  materialize(rec.startDate, addDays(todayLocal(), 35));
  save();
  return { recurrence: rec };
});
on("PATCH", "/api/recurrences/:id", (p, _q, body) => {
  const rec = db().recurrences.find((r) => r.id === p.id);
  if (!rec) throw notFound("Tekrar");
  const parsed = parse(recurrenceInputSchema.partial(), body);
  const data = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in obj(body))) as typeof parsed;
  if (data.frequency === "WEEKLY" && data.weekdays && data.weekdays.length === 0) throw badRequest("Haftalık tekrar için en az bir gün seçin.");
  Object.assign(rec, data, { updatedAt: nowIso() });
  const from = str(obj(body).fromDate) || todayLocal();
  syncSeries(rec, from);
  materialize(from, addDays(todayLocal(), 35));
  save();
  return { recurrence: rec };
});
on("DELETE", "/api/recurrences/:id", (p) => {
  const d = db();
  const rec = d.recurrences.find((r) => r.id === p.id);
  if (!rec) throw notFound("Tekrar");
  const today = todayLocal();
  d.tasks = d.tasks.filter((t) => !(t.recurrenceId === rec.id && t.status === "PLANNED" && t.date >= today && !t.detached));
  for (const t of d.tasks) if (t.recurrenceId === rec.id) t.detached = true;
  rec.active = false;
  rec.endDate = addDays(today, -1);
  save();
  return { ok: true };
});

/* ---------------- Alışkanlıklar ve uyku ---------------- */
function habitView(h: HabitRec, from: string, to: string) {
  const d = db();
  const logs = d.habitLogs.filter((l) => l.habitId === h.id);
  const done = new Set(logs.filter((l) => l.status === "DONE").map((l) => l.date));
  const today = todayLocal();
  let streak = 0;
  let cursor = done.has(today) ? today : addDays(today, -1);
  for (let i = 0; i < 1000; i++) {
    const relevant = h.frequency !== "DAILY" || h.weekdays.includes(weekday(cursor));
    if (relevant) {
      if (done.has(cursor)) streak++;
      else break;
    }
    cursor = addDays(cursor, -1);
  }
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const x of [...done].sort()) {
    run = prev && addDays(prev, 1) === x ? run + 1 : 1;
    best = Math.max(best, run);
    prev = x;
  }
  const ws = weekStart(today);
  const weekDone = [...done].filter((x) => x >= ws && x <= addDays(ws, 6)).length;
  return { ...h, logs: logs.filter((l) => l.date >= from && l.date <= to).sort((a, b) => a.date.localeCompare(b.date)), streak, bestStreak: best, weekDone, totalDone: done.size };
}
on("GET", "/api/habits", (_p, q) => {
  const to = parse(dateSchema, q.get("to") ?? todayLocal());
  const from = parse(dateSchema, q.get("from") ?? addDays(to, -27));
  const habits = db().habits.filter((h) => q.get("all") === "1" || h.active).map((h) => habitView(h, from, to));
  return { habits, from, to };
});
on("POST", "/api/habits", (_p, _q, body) => {
  const data = parse(habitSchema, body);
  const habit: HabitRec = { id: newId(), name: data.name, categoryId: data.categoryId ?? null, icon: data.icon ?? "check", frequency: data.frequency ?? "DAILY", weekdays: data.weekdays ?? [0, 1, 2, 3, 4, 5, 6], dailyTarget: data.dailyTarget ?? 1, weeklyTarget: data.weeklyTarget ?? 7, active: data.active ?? true, createdAt: nowIso(), archivedAt: null };
  db().habits.push(habit);
  save();
  return { habit };
});
on("PATCH", "/api/habits/:id", (p, _q, body) => {
  const h = db().habits.find((x) => x.id === p.id);
  if (!h) throw notFound("Alışkanlık");
  const data = parse(habitSchema.partial(), body);
  Object.assign(h, data);
  if (data.active === false) h.archivedAt = nowIso();
  if (data.active === true) h.archivedAt = null;
  save();
  return { habit: h };
});
on("DELETE", "/api/habits/:id", (p) => {
  const h = db().habits.find((x) => x.id === p.id);
  if (!h) throw notFound("Alışkanlık");
  h.active = false;
  h.archivedAt = nowIso();
  save();
  return { ok: true };
});
on("POST", "/api/habits/:id/log", (p, _q, body) => {
  const h = db().habits.find((x) => x.id === p.id);
  if (!h) throw notFound("Alışkanlık");
  const data = parse(habitLogSchema, body);
  const d = db();
  let log = d.habitLogs.find((l) => l.habitId === h.id && l.date === data.date);
  if (log) Object.assign(log, { status: data.status, value: data.value ?? 1, note: data.note ?? null });
  else {
    log = { id: newId(), habitId: h.id, date: data.date, status: data.status, value: data.value ?? 1, note: data.note ?? null, createdAt: nowIso() };
    d.habitLogs.push(log);
  }
  save();
  return { log };
});
on("DELETE", "/api/habits/:id/log/:date", (p) => {
  const d = db();
  const date = parse(dateSchema, p.date);
  d.habitLogs = d.habitLogs.filter((l) => !(l.habitId === p.id && l.date === date));
  save();
  return { ok: true };
});
on("GET", "/api/sleep", (_p, q) => {
  const to = parse(dateSchema, q.get("to") ?? todayLocal());
  const from = parse(dateSchema, q.get("from") ?? addDays(to, -29));
  return { logs: db().sleepLogs.filter((l) => l.date >= from && l.date <= to).sort((a, b) => a.date.localeCompare(b.date)) };
});
on("POST", "/api/sleep", (_p, _q, body) => {
  const data = parse(z.object({ date: dateSchema, bedTime: z.string(), wakeTime: z.string(), quality: z.number().int().min(1).max(5).optional() }), body);
  const [bh, bm] = data.bedTime.split(":").map(Number);
  const [wh, wm] = data.wakeTime.split(":").map(Number);
  let minutes = wh * 60 + wm - (bh * 60 + bm);
  if (minutes <= 0) minutes += 24 * 60;
  const d = db();
  let log = d.sleepLogs.find((l) => l.date === data.date);
  if (log) Object.assign(log, { bedTime: data.bedTime, wakeTime: data.wakeTime, minutes, quality: data.quality ?? 3 });
  else {
    log = { id: newId(), date: data.date, bedTime: data.bedTime, wakeTime: data.wakeTime, minutes, quality: data.quality ?? 3 };
    d.sleepLogs.push(log);
  }
  save();
  return { log };
});

/* ---------------- Hedefler ve notlar ---------------- */
function goalView(g: Database["goals"][number]) {
  const d = db();
  const milestones = d.milestones.filter((m) => m.goalId === g.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const doneTasks = d.tasks.filter((t) => t.goalId === g.id && t.status === "DONE");
  const done = milestones.filter((m) => m.done).length;
  return { ...g, milestones, progress: milestones.length ? Math.round((done / milestones.length) * 100) : g.status === "COMPLETED" ? 100 : 0, minutesDone: doneTasks.reduce((a, t) => a + t.durationMinutes, 0), tasksDone: doneTasks.length, _count: { notes: d.notes.filter((n) => n.goalId === g.id).length, tasks: d.tasks.filter((t) => t.goalId === g.id).length } };
}
const ownGoal = (id: string) => {
  const g = db().goals.find((x) => x.id === id);
  if (!g) throw notFound("Hedef");
  return g;
};
on("GET", "/api/goals/areas", () => ({ areas: LEARNING_AREAS }));
on("GET", "/api/goals", () => ({ goals: [...db().goals].sort((a, b) => a.status.localeCompare(b.status) || b.createdAt.localeCompare(a.createdAt)).map(goalView) }));
on("POST", "/api/goals", (_p, _q, body) => {
  const { milestones, ...data } = parse(goalSchema, body);
  const d = db();
  const ts = nowIso();
  const goal = { id: newId(), title: data.title, description: data.description ?? null, area: data.area ?? "general", categoryId: data.categoryId ?? null, targetDate: data.targetDate ?? null, status: data.status ?? "ACTIVE", createdAt: ts, updatedAt: ts };
  d.goals.push(goal);
  (milestones ?? []).forEach((title, i) => d.milestones.push({ id: newId(), goalId: goal.id, title, done: false, sortOrder: i, doneAt: null }));
  save();
  return { goal: goalView(goal) };
});
on("PATCH", "/api/goals/:id", (p, _q, body) => {
  const g = ownGoal(p.id);
  const { milestones: _m, ...data } = parse(goalSchema.partial(), body);
  void _m;
  Object.assign(g, data, { updatedAt: nowIso() });
  save();
  return { goal: goalView(g) };
});
on("DELETE", "/api/goals/:id", (p) => {
  ownGoal(p.id);
  const d = db();
  d.goals = d.goals.filter((g) => g.id !== p.id);
  d.milestones = d.milestones.filter((m) => m.goalId !== p.id);
  d.notes = d.notes.filter((n) => n.goalId !== p.id);
  for (const t of d.tasks) if (t.goalId === p.id) t.goalId = null;
  save();
  return { ok: true };
});
on("POST", "/api/goals/:id/milestones", (p, _q, body) => {
  const g = ownGoal(p.id);
  const data = parse(z.object({ title: z.string().trim().min(1).max(200) }), body);
  const d = db();
  const milestone = { id: newId(), goalId: g.id, title: data.title, done: false, sortOrder: d.milestones.filter((m) => m.goalId === g.id).length, doneAt: null };
  d.milestones.push(milestone);
  if (g.status === "COMPLETED") g.status = "ACTIVE";
  save();
  return { milestone };
});
on("PATCH", "/api/goals/:id/milestones/:mid", (p, _q, body) => {
  const g = ownGoal(p.id);
  const data = parse(milestoneSchema, body);
  const d = db();
  const m = d.milestones.find((x) => x.id === p.mid && x.goalId === g.id);
  if (!m) throw notFound("Aşama");
  Object.assign(m, data);
  if (data.done === true) m.doneAt = nowIso();
  if (data.done === false) m.doneAt = null;
  const all = d.milestones.filter((x) => x.goalId === g.id);
  const remaining = all.filter((x) => !x.done).length;
  if (all.length > 0 && remaining === 0 && g.status === "ACTIVE") g.status = "COMPLETED";
  if (remaining > 0 && g.status === "COMPLETED") g.status = "ACTIVE";
  save();
  return { milestone: m };
});
on("DELETE", "/api/goals/:id/milestones/:mid", (p) => {
  ownGoal(p.id);
  const d = db();
  d.milestones = d.milestones.filter((m) => !(m.id === p.mid && m.goalId === p.id));
  save();
  return { ok: true };
});
on("GET", "/api/notes", (_p, q) => {
  const goalId = q.get("goalId");
  const kind = q.get("kind");
  return { notes: db().notes.filter((n) => (!goalId || n.goalId === goalId) && (!kind || n.kind === kind)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
});
on("POST", "/api/notes", (_p, _q, body) => {
  const data = parse(noteSchema, body);
  if (data.goalId) ownGoal(data.goalId);
  const ts = nowIso();
  const note = { id: newId(), goalId: data.goalId ?? null, kind: data.kind ?? "note", title: data.title, content: data.content ?? "", tags: data.tags ?? [], mastered: data.mastered ?? false, createdAt: ts, updatedAt: ts };
  db().notes.push(note);
  save();
  return { note };
});
on("PATCH", "/api/notes/:id", (p, _q, body) => {
  const n = db().notes.find((x) => x.id === p.id);
  if (!n) throw notFound("Not");
  Object.assign(n, parse(noteSchema.partial(), body), { updatedAt: nowIso() });
  save();
  return { note: n };
});
on("DELETE", "/api/notes/:id", (p) => {
  const d = db();
  d.notes = d.notes.filter((n) => n.id !== p.id);
  save();
  return { ok: true };
});

/* ---------------- Şablonlar ---------------- */
on("GET", "/api/templates", () => ({ templates: [...db().templates].reverse() }));
on("POST", "/api/templates", (_p, _q, body) => {
  const data = parse(templateSchema, body);
  const from = data.kind === "DAY" ? data.sourceDate : weekStart(data.sourceDate);
  const to = data.kind === "DAY" ? data.sourceDate : addDays(from, 6);
  materialize(from, to);
  const payload = db()
    .tasks.filter((t) => t.date >= from && t.date <= to && (t.status === "PLANNED" || t.status === "DONE"))
    .map((t) => ({ dayOffset: daysBetween(from, t.date), title: t.title, notes: t.notes, categoryId: t.categoryId, startTime: t.startTime, durationMinutes: t.durationMinutes, priority: t.priority, timeType: t.timeType, flexibility: t.flexibility, difficulty: t.difficulty }));
  if (payload.length === 0) throw badRequest("Seçilen aralıkta görev yok.");
  const template = { id: newId(), name: data.name, kind: data.kind, payload, createdAt: nowIso() };
  db().templates.push(template);
  save();
  return { template };
});
on("POST", "/api/templates/:id/apply", (p, _q, body) => {
  const t = db().templates.find((x) => x.id === p.id);
  if (!t) throw notFound("Şablon");
  const { targetDate } = parse(z.object({ targetDate: dateSchema }), body);
  const base = t.kind === "DAY" ? targetDate : weekStart(targetDate);
  const items = t.payload as Array<Record<string, unknown> & { dayOffset: number }>;
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
  const r = applyOperations(ops, { description: `"${t.name}" şablonu uygulandı (${targetDate})` });
  return { applied: ops.length, changeSetId: r.changeSetId };
});
on("DELETE", "/api/templates/:id", (p) => {
  const d = db();
  d.templates = d.templates.filter((t) => t.id !== p.id);
  save();
  return { ok: true };
});

/* ---------------- İstatistik ---------------- */
on("GET", "/api/stats", (_p, q) => {
  const today = todayLocal();
  const date = q.get("date") ?? today;
  let from: string;
  let to: string;
  if (q.get("range") === "month") {
    from = monthStart(date);
    to = monthEnd(date);
  } else if (q.get("range") === "day") from = to = parse(dateSchema, date);
  else if (q.get("from") && q.get("to")) {
    from = parse(dateSchema, q.get("from"));
    to = parse(dateSchema, q.get("to"));
  } else {
    from = weekStart(date);
    to = addDays(from, 6);
  }
  materialize(from, to);
  return computeStats(from, to);
});

/* ---------------- Veri ---------------- */
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
on("GET", "/api/data/export.json", () => {
  const d = db();
  const { ai: _ai, ...rest } = d; // API anahtarı yedeğe girmez
  void _ai;
  return { filename: `lifeflow-yedek-${todayLocal()}.json`, type: "application/json", content: JSON.stringify({ exportedAt: nowIso(), ...rest }, null, 1) };
});
on("GET", "/api/data/export.csv", () => {
  const d = db();
  const catName = new Map(d.categories.map((c) => [c.id, c.name]));
  const header = ["id", "tarih", "baslangic", "bitis", "sure_dk", "baslik", "kategori", "oncelik", "zaman_turu", "esneklik", "durum", "son_tarih", "zorluk", "erteleme", "notlar"];
  const rows = sortTasks(d.tasks).map((t) => [t.id, t.date, t.startTime, t.endTime, t.durationMinutes, t.title, t.categoryId ? catName.get(t.categoryId) : "", t.priority, t.timeType, t.flexibility, t.status, t.deadline, t.difficulty, t.postponeCount, t.notes].map(csvEscape).join(","));
  return { filename: `lifeflow-gorevler-${todayLocal()}.csv`, type: "text/csv;charset=utf-8", content: "﻿" + [header.join(","), ...rows].join("\n") };
});
on("POST", "/api/data/import", (_p, _q, body) => {
  const b = obj(body);
  if (!Array.isArray(b.tasks) && !Array.isArray(b.categories) && !Array.isArray(b.habits)) throw badRequest("Geçersiz yedek dosyası.");
  const d = db();
  const catIdMap = new Map<string, string>();
  for (const c of (b.categories ?? []) as Array<{ id: string; name: string; color?: string; icon?: string; weeklyTargetMinutes?: number }>) {
    const found = d.categories.find((e) => e.name === c.name);
    if (found) catIdMap.set(c.id, found.id);
    else {
      const created = { id: newId(), name: c.name, color: c.color ?? "#6366f1", icon: c.icon ?? "circle", isDefault: false, weeklyTargetMinutes: c.weeklyTargetMinutes ?? 0, sortOrder: d.categories.length };
      d.categories.push(created);
      catIdMap.set(c.id, created.id);
    }
  }
  const existingIds = new Set(d.tasks.map((t) => t.id));
  let tasks = 0;
  for (const t of (b.tasks ?? []) as Array<Record<string, unknown>>) {
    if (typeof t.title !== "string" || typeof t.date !== "string") continue;
    const id = typeof t.id === "string" && !existingIds.has(t.id) ? t.id : newId();
    const ts = nowIso();
    d.tasks.push({
      id,
      userId: "local",
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
      completedAt: (t.completedAt as string | null) ?? null,
      recurrenceId: null,
      seriesDate: null,
      detached: false,
      goalId: null,
      createdAt: (t.createdAt as string) ?? ts,
      updatedAt: ts,
    });
    tasks++;
  }
  let habits = 0;
  const importedLogs = (b.habitLogs ?? []) as Array<Record<string, unknown>>;
  for (const h of (b.habits ?? []) as Array<Record<string, unknown> & { logs?: Array<Record<string, unknown>> }>) {
    if (typeof h.name !== "string") continue;
    const created: HabitRec = { id: newId(), name: h.name, categoryId: h.categoryId ? catIdMap.get(String(h.categoryId)) ?? null : null, icon: (h.icon as string) ?? "check", frequency: (h.frequency as "DAILY" | "WEEKLY") ?? "DAILY", weekdays: Array.isArray(h.weekdays) ? (h.weekdays as number[]) : [0, 1, 2, 3, 4, 5, 6], dailyTarget: Number(h.dailyTarget ?? 1), weeklyTarget: Number(h.weeklyTarget ?? 7), active: h.active !== false, createdAt: nowIso(), archivedAt: null };
    d.habits.push(created);
    const logs = [...(h.logs ?? []), ...importedLogs.filter((l) => l.habitId === h.id)];
    for (const l of logs) {
      if (typeof l.date !== "string" || d.habitLogs.some((x) => x.habitId === created.id && x.date === l.date)) continue;
      d.habitLogs.push({ id: newId(), habitId: created.id, date: l.date, status: (l.status as "DONE" | "SKIPPED" | "POSTPONED") ?? "DONE", value: Number(l.value ?? 1), note: null, createdAt: nowIso() });
    }
    habits++;
  }
  save();
  return { imported: { tasks, habits, categories: catIdMap.size } };
});
on("DELETE", "/api/data/account", (_p, _q, body) => {
  parse(z.object({ confirm: z.literal("SİL") }), body);
  const ai = { ...db().ai };
  resetDatabase();
  const fresh = emptyDatabase();
  fresh.ai = ai;
  replaceDatabase(fresh);
  return { ok: true };
});

/* ---------------- AI ---------------- */
on("GET", "/api/ai/status", () => ({ enabled: aiEnabled(), model: MODEL(), usage: usageSummary(), hasKey: aiEnabled(), dailyLimit: db().ai.dailyLimit }));
on("PUT", "/api/ai/config", (_p, _q, body) => {
  const data = parse(z.object({ apiKey: z.string().max(300).optional(), model: z.string().min(1).max(80).optional(), dailyLimit: z.number().int().min(1).max(1000).optional() }), body);
  Object.assign(db().ai, data);
  save();
  return { enabled: aiEnabled(), model: MODEL(), dailyLimit: db().ai.dailyLimit };
});
on("POST", "/api/ai/chat", async (_p, _q, body) => {
  const data = parse(z.object({ message: z.string().trim().min(1).max(4000), history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(40).default([]) }), body);
  return runAssistant(data.history, data.message);
});
on("GET", "/api/ai/proposals", () => ({ proposals: [...db().proposals].filter((p) => p.status === "PENDING").reverse().slice(0, 10).map(toProposalDTO) }));
on("POST", "/api/ai/proposals/:id/apply", (p) => {
  const pr = db().proposals.find((x) => x.id === p.id);
  if (!pr) throw notFound("Öneri");
  if (pr.status !== "PENDING") throw badRequest("Bu öneri zaten sonuçlanmış.");
  const r = applyOperations(pr.operations, { description: `AI: ${pr.summary}`, source: "AI" });
  pr.status = "APPLIED";
  pr.resolvedAt = nowIso();
  save();
  return { ...r, proposal: toProposalDTO(pr) };
});
on("POST", "/api/ai/proposals/:id/reject", (p) => {
  const pr = db().proposals.find((x) => x.id === p.id);
  if (!pr) throw notFound("Öneri");
  pr.status = "REJECTED";
  pr.resolvedAt = nowIso();
  save();
  return { ok: true };
});
on("POST", "/api/ai/weekly-review", async (_p, _q, body) => {
  const { date, force } = parse(z.object({ date: dateSchema.optional(), force: z.boolean().optional() }), body ?? {});
  return weeklyReview(date, force);
});
on("GET", "/api/ai/weekly-review", (_p, q) => cachedReview(q.get("date") ?? todayLocal()));
