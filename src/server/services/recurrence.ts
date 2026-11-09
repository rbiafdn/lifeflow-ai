// Tekrarlayan görevler: belirli tarih aralığı için örnekleri (Task satırları) üretir.
// Tek bir örneği değiştirmek "detached" işaretiyle seriden ayırır; seriyi değiştirmek
// yalnızca ayrılmamış ve henüz tamamlanmamış örnekleri günceller.

import type { Recurrence } from "@prisma/client";
import { prisma } from "../db";
import { dateRange, weekday, daysBetween, toMinutes, toHHMM } from "../../shared/time";

export function occurs(rec: Recurrence, date: string): boolean {
  if (!rec.active) return false;
  if (date < rec.startDate) return false;
  if (rec.endDate && date > rec.endDate) return false;
  const interval = Math.max(1, rec.interval);
  if (rec.frequency === "DAILY") {
    return daysBetween(rec.startDate, date) % interval === 0;
  }
  // WEEKLY
  if (!rec.weekdays.includes(weekday(date))) return false;
  const weeks = Math.floor(daysBetween(rec.startDate, date) / 7);
  return weeks % interval === 0;
}

export function endTimeOf(startTime: string | null, duration: number): string | null {
  return startTime ? toHHMM(toMinutes(startTime) + duration) : null;
}

/** Aralıktaki eksik örnekleri oluşturur (idempotent). */
export async function materialize(userId: string, from: string, to: string): Promise<void> {
  const recs = await prisma.recurrence.findMany({ where: { userId, active: true } });
  if (recs.length === 0) return;
  const existing = await prisma.task.findMany({
    where: { userId, recurrenceId: { not: null }, seriesDate: { gte: from, lte: to } },
    select: { recurrenceId: true, seriesDate: true },
  });
  const have = new Set(existing.map((e) => `${e.recurrenceId}|${e.seriesDate}`));
  const rows = [];
  for (const rec of recs) {
    for (const date of dateRange(from, to)) {
      if (!occurs(rec, date) || have.has(`${rec.id}|${date}`)) continue;
      rows.push({
        userId,
        recurrenceId: rec.id,
        seriesDate: date,
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
        difficulty: rec.difficulty,
      });
    }
  }
  if (rows.length) await prisma.task.createMany({ data: rows, skipDuplicates: true });
}

/** Seri güncellendiğinde gelecekteki, ayrılmamış ve planlı örnekleri senkronla. */
export async function syncSeries(rec: Recurrence, fromDate: string) {
  // Artık kurala uymayan gelecek örnekleri sil (tamamlanmış/iptal olanlar geçmiş olarak kalır)
  const future = await prisma.task.findMany({
    where: { recurrenceId: rec.id, seriesDate: { gte: fromDate }, detached: false, status: "PLANNED" },
  });
  const toDelete = future.filter((t) => !occurs(rec, t.seriesDate!)).map((t) => t.id);
  if (toDelete.length) await prisma.task.deleteMany({ where: { id: { in: toDelete } } });
  await prisma.task.updateMany({
    where: { recurrenceId: rec.id, seriesDate: { gte: fromDate }, detached: false, status: "PLANNED" },
    data: {
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
    },
  });
}
