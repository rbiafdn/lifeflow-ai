// İstatistikler yalnızca gerçek veriden hesaplanır.

import { db } from "./db";
import { dateRange, weekday, toMinutes, DAY_MINUTES, addDays } from "../shared/time";

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

export function computeStats(from: string, to: string): RangeStats {
  const d = db();
  const tasks = d.tasks.filter((t) => t.date >= from && t.date <= to);
  const totals = { planned: 0, done: 0, skipped: 0, cancelled: 0, failed: 0, postponed: 0, total: tasks.length };
  let postponeEvents = 0;
  for (const t of tasks) {
    const key = t.status.toLowerCase() as keyof typeof totals;
    if (key in totals && key !== "total") totals[key]++;
    postponeEvents += t.postponeCount;
  }
  const scorable = tasks.filter((t) => t.status !== "CANCELLED");
  const completionRate = scorable.length ? Math.round((totals.done / scorable.length) * 100) : 0;

  const byDay = dateRange(from, to).map((date) => {
    const dayTasks = tasks.filter((t) => t.date === date && t.status !== "CANCELLED");
    const done = dayTasks.filter((t) => t.status === "DONE");
    return { date, done: done.length, total: dayTasks.length, rate: dayTasks.length ? Math.round((done.length / dayTasks.length) * 100) : 0, minutesDone: done.reduce((a, t) => a + t.durationMinutes, 0) };
  });

  const catMap = new Map(d.categories.map((c) => [c.id, c]));
  const byCategoryMap = new Map<string, RangeStats["byCategory"][number]>();
  for (const t of tasks) {
    const key = t.categoryId ?? "none";
    const c = t.categoryId ? catMap.get(t.categoryId) : undefined;
    const entry = byCategoryMap.get(key) ?? { categoryId: t.categoryId, name: c?.name ?? "Kategorisiz", color: c?.color ?? "#9ca3af", minutesDone: 0, minutesPlanned: 0, weeklyTarget: c?.weeklyTargetMinutes ?? 0, done: 0, total: 0 };
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

  const habits = d.habits.filter((h) => h.active).map((h) => {
    const logs = d.habitLogs.filter((l) => l.habitId === h.id);
    const inRange = logs.filter((l) => l.date >= from && l.date <= to);
    const expectedDays = dateRange(from, to).filter((x) => (h.frequency === "DAILY" ? h.weekdays.includes(weekday(x)) : true));
    const expected = h.frequency === "DAILY" ? expectedDays.length : Math.ceil((expectedDays.length / 7) * h.weeklyTarget);
    const done = inRange.filter((l) => l.status === "DONE").length;
    const doneSet = new Set(logs.filter((l) => l.status === "DONE").map((l) => l.date));
    let streak = 0;
    let cursor = to;
    for (let i = 0; i < 400; i++) {
      const relevant = h.frequency !== "DAILY" || h.weekdays.includes(weekday(cursor));
      if (relevant) {
        if (doneSet.has(cursor)) streak++;
        else break;
      }
      cursor = addDays(cursor, -1);
    }
    return { habitId: h.id, name: h.name, done, expected, rate: expected ? Math.min(100, Math.round((done / expected) * 100)) : 0, streak };
  });

  const w = toMinutes(d.settings.wakeTime);
  let s = toMinutes(d.settings.sleepTime);
  if (s > w) s -= DAY_MINUTES;
  const sleepLogs = d.sleepLogs.filter((l) => l.date >= from && l.date <= to);
  const sleep = { avgMinutes: sleepLogs.length ? Math.round(sleepLogs.reduce((a, l) => a + l.minutes, 0) / sleepLogs.length) : null, nights: sleepLogs.length, plannedMinutes: w - s };

  return { from, to, totals, completionRate, postponeEvents, byDay, byCategory, habits, sleep };
}
