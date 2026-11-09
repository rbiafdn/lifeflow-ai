// İstatistikler yalnızca gerçek veriden hesaplanır.

import { prisma } from "../db";
import { dateRange, weekday, toMinutes, DAY_MINUTES } from "../../shared/time";

export interface RangeStats {
  from: string;
  to: string;
  totals: { planned: number; done: number; skipped: number; cancelled: number; failed: number; postponed: number; total: number };
  completionRate: number;
  postponeEvents: number;
  byDay: { date: string; done: number; total: number; rate: number; minutesDone: number }[];
  byCategory: { categoryId: string | null; name: string; color: string; minutesDone: number; minutesPlanned: number; weeklyTarget: number; done: number; total: number }[];
  habits: { habitId: string; name: string; done: number; expected: number; rate: number; streak: number }[];
  sleep: { avgMinutes: number | null; nights: number; plannedMinutes: number };
}

export async function computeStats(userId: string, from: string, to: string): Promise<RangeStats> {
  const [tasks, categories, habits, settings, sleepLogs] = await Promise.all([
    prisma.task.findMany({ where: { userId, date: { gte: from, lte: to } } }),
    prisma.category.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } }),
    prisma.habit.findMany({ where: { userId, active: true }, include: { logs: { where: { date: { gte: from, lte: to } } } } }),
    prisma.userSettings.findUnique({ where: { userId } }),
    prisma.sleepLog.findMany({ where: { userId, date: { gte: from, lte: to } } }),
  ]);

  const totals = { planned: 0, done: 0, skipped: 0, cancelled: 0, failed: 0, postponed: 0, total: tasks.length };
  let postponeEvents = 0;
  for (const t of tasks) {
    if (t.status === "PLANNED") totals.planned++;
    else if (t.status === "DONE") totals.done++;
    else if (t.status === "SKIPPED") totals.skipped++;
    else if (t.status === "CANCELLED") totals.cancelled++;
    else if (t.status === "FAILED") totals.failed++;
    else if (t.status === "POSTPONED") totals.postponed++;
    postponeEvents += t.postponeCount;
  }
  // İptal edilenler orana dahil edilmez; planlı olup geçmiş günde kalanlar "yapılmadı" sayılır.
  const scorable = tasks.filter((t) => t.status !== "CANCELLED");
  const completionRate = scorable.length ? Math.round((totals.done / scorable.length) * 100) : 0;

  const byDay = dateRange(from, to).map((date) => {
    const dayTasks = tasks.filter((t) => t.date === date && t.status !== "CANCELLED");
    const done = dayTasks.filter((t) => t.status === "DONE");
    return {
      date,
      done: done.length,
      total: dayTasks.length,
      rate: dayTasks.length ? Math.round((done.length / dayTasks.length) * 100) : 0,
      minutesDone: done.reduce((a, t) => a + t.durationMinutes, 0),
    };
  });

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const byCategoryMap = new Map<string, RangeStats["byCategory"][number]>();
  for (const t of tasks) {
    const key = t.categoryId ?? "none";
    const c = t.categoryId ? catMap.get(t.categoryId) : undefined;
    const entry =
      byCategoryMap.get(key) ??
      {
        categoryId: t.categoryId,
        name: c?.name ?? "Kategorisiz",
        color: c?.color ?? "#9ca3af",
        minutesDone: 0,
        minutesPlanned: 0,
        weeklyTarget: c?.weeklyTargetMinutes ?? 0,
        done: 0,
        total: 0,
      };
    if (t.status !== "CANCELLED") {
      entry.total++;
      entry.minutesPlanned += t.durationMinutes;
    }
    if (t.status === "DONE") {
      entry.done++;
      entry.minutesDone += t.durationMinutes;
    }
    byCategoryMap.set(key, entry);
  }
  const byCategory = [...byCategoryMap.values()].sort((a, b) => b.minutesDone - a.minutesDone);

  const habitStats = habits.map((h) => {
    const expectedDays = dateRange(from, to).filter((d) => h.frequency === "DAILY" ? h.weekdays.includes(weekday(d)) : true);
    const expected = h.frequency === "DAILY" ? expectedDays.length : Math.ceil((expectedDays.length / 7) * h.weeklyTarget);
    const done = h.logs.filter((l) => l.status === "DONE").length;
    return { habitId: h.id, name: h.name, done, expected, rate: expected ? Math.min(100, Math.round((done / expected) * 100)) : 0, streak: 0 };
  });
  // Seri: bugünden geriye kesintisiz DONE günleri (tüm geçmişe bakar)
  for (const hs of habitStats) {
    const logs = await prisma.habitLog.findMany({ where: { habitId: hs.habitId, status: "DONE" }, select: { date: true }, orderBy: { date: "desc" } });
    const set = new Set(logs.map((l) => l.date));
    let streak = 0;
    let cursor = to;
    const habit = habits.find((h) => h.id === hs.habitId)!;
    for (let i = 0; i < 400; i++) {
      const relevant = habit.frequency !== "DAILY" || habit.weekdays.includes(weekday(cursor));
      if (relevant) {
        if (set.has(cursor)) streak++;
        else if (i > 0 || cursor < to) break;
        else break;
      }
      const d = new Date(cursor + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      cursor = d.toISOString().slice(0, 10);
    }
    hs.streak = streak;
  }

  const plannedSleep = settings
    ? (() => {
        const w = toMinutes(settings.wakeTime);
        let s = toMinutes(settings.sleepTime);
        if (s > w) s -= DAY_MINUTES;
        return w - s;
      })()
    : 0;
  const sleep = {
    avgMinutes: sleepLogs.length ? Math.round(sleepLogs.reduce((a, l) => a + l.minutes, 0) / sleepLogs.length) : null,
    nights: sleepLogs.length,
    plannedMinutes: plannedSleep,
  };

  return { from, to, totals, completionRate, postponeEvents, byDay, byCategory, habits: habitStats, sleep };
}
