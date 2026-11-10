// Tekrarlayan görevler: aralık için örnekleri üretir; tek örnek ↔ seri ayrımı.

import { db, save, newId, nowIso, type RecurrenceRec, type TaskRec } from "./db";
import { dateRange, weekday, daysBetween, toMinutes, toHHMM } from "../shared/time";

export function occurs(rec: RecurrenceRec, date: string): boolean {
  if (!rec.active) return false;
  if (date < rec.startDate) return false;
  if (rec.endDate && date > rec.endDate) return false;
  const interval = Math.max(1, rec.interval);
  if (rec.frequency === "DAILY") return daysBetween(rec.startDate, date) % interval === 0;
  if (!rec.weekdays.includes(weekday(date))) return false;
  const weeks = Math.floor(daysBetween(rec.startDate, date) / 7);
  return weeks % interval === 0;
}

export function endTimeOf(startTime: string | null, duration: number): string | null {
  return startTime ? toHHMM(toMinutes(startTime) + duration) : null;
}

/** Aralıktaki eksik örnekleri oluşturur (idempotent). */
export function materialize(from: string, to: string): void {
  const d = db();
  const recs = d.recurrences.filter((r) => r.active);
  if (recs.length === 0) return;
  const have = new Set(d.tasks.filter((t) => t.recurrenceId).map((t) => `${t.recurrenceId}|${t.seriesDate}`));
  let added = 0;
  for (const rec of recs) {
    for (const date of dateRange(from, to)) {
      if (!occurs(rec, date) || have.has(`${rec.id}|${date}`)) continue;
      const ts = nowIso();
      d.tasks.push({
        id: newId(),
        userId: "local",
        recurrenceId: rec.id,
        seriesDate: date,
        detached: false,
        categoryId: rec.categoryId,
        title: rec.title,
        notes: rec.notes,
        date,
        startTime: rec.startTime,
        endTime: endTimeOf(rec.startTime, rec.durationMinutes),
        durationMinutes: rec.durationMinutes,
        priority: rec.priority,
        timeType: rec.timeType,
        flexibility: rec.flexibility,
        deadline: null,
        status: "PLANNED",
        difficulty: rec.difficulty,
        postponeCount: 0,
        completedAt: null,
        goalId: null,
        createdAt: ts,
        updatedAt: ts,
      });
      have.add(`${rec.id}|${date}`);
      added++;
    }
  }
  if (added) save();
}

/** Seri güncellendiğinde gelecekteki, ayrılmamış ve planlı örnekleri senkronla. */
export function syncSeries(rec: RecurrenceRec, fromDate: string) {
  const d = db();
  d.tasks = d.tasks.filter((t) => !(t.recurrenceId === rec.id && t.seriesDate! >= fromDate && !t.detached && t.status === "PLANNED" && !occurs(rec, t.seriesDate!)));
  for (const t of d.tasks) {
    if (t.recurrenceId !== rec.id || t.seriesDate! < fromDate || t.detached || t.status !== "PLANNED") continue;
    Object.assign(t, {
      title: rec.title,
      notes: rec.notes,
      categoryId: rec.categoryId,
      startTime: rec.startTime,
      endTime: endTimeOf(rec.startTime, rec.durationMinutes),
      durationMinutes: rec.durationMinutes,
      priority: rec.priority,
      timeType: rec.timeType,
      flexibility: rec.flexibility,
      difficulty: rec.difficulty,
      updatedAt: nowIso(),
    } satisfies Partial<TaskRec>);
  }
}
