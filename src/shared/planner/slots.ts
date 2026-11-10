// Zaman dilimi hesapları: boş zaman bulma, çakışma tespiti, görev yerleştirme.
// Tamamen saf fonksiyonlar; veritabanına dokunmaz.

import { toMinutes, toHHMM, weekday, DAY_MINUTES } from "../time";
import type { Priority, TimeType, TaskStatus, SettingsDTO } from "../types";

export interface Slot {
  start: number; // dakika, gece yarısından itibaren
  end: number;
}

export interface PlannerTask {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
  durationMinutes: number;
  priority: Priority;
  timeType: TimeType;
  flexibility: number;
  deadline: string | null;
  status: TaskStatus;
  categoryId: string | null;
  difficulty: number;
  postponeCount: number;
  goalId?: string | null;
  notes?: string | null;
  recurrenceId?: string | null;
}

export type PlannerSettings = Pick<
  SettingsDTO,
  | "wakeTime"
  | "sleepTime"
  | "workStart"
  | "workEnd"
  | "workDays"
  | "commuteMinutes"
  | "dailyFreeMinutes"
  | "focusStart"
  | "focusEnd"
  | "restDays"
  | "sportDays"
>;

export const DEFAULT_BUFFER = 10;
export const MIN_SLOT = 15;

export const PRIORITY_RANK: Record<Priority, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
export const TIME_TYPE_RANK: Record<TimeType, number> = { FIXED: 5, PRIORITY: 4, FLEXIBLE: 3, REST: 2, OPTIONAL: 1 };

/** Zaman kaplayan durumlar (planlanmış veya yapılmış). */
export function occupiesTime(status: TaskStatus): boolean {
  return status === "PLANNED" || status === "DONE";
}

export function dayBounds(settings: PlannerSettings): Slot {
  const wake = toMinutes(settings.wakeTime);
  let sleep = toMinutes(settings.sleepTime);
  if (sleep <= wake) sleep += DAY_MINUTES; // örn. 00:30 uyku
  return { start: wake, end: sleep };
}

export function isWorkDay(date: string, settings: PlannerSettings): boolean {
  return settings.workDays.includes(weekday(date));
}

export function workBlock(date: string, settings: PlannerSettings): Slot | null {
  if (!isWorkDay(date, settings)) return null;
  const start = toMinutes(settings.workStart) - settings.commuteMinutes;
  const end = toMinutes(settings.workEnd) + settings.commuteMinutes;
  return { start: Math.max(0, start), end: Math.min(DAY_MINUTES, end) };
}

export function focusWindow(settings: PlannerSettings): Slot {
  const start = toMinutes(settings.focusStart);
  let end = toMinutes(settings.focusEnd);
  if (end <= start) end += DAY_MINUTES;
  return { start, end };
}

export function taskSlot(t: Pick<PlannerTask, "startTime" | "durationMinutes">): Slot | null {
  if (!t.startTime) return null;
  const s = toMinutes(t.startTime);
  return { start: s, end: s + t.durationMinutes };
}

export function mergeSlots(slots: Slot[]): Slot[] {
  const sorted = [...slots].sort((a, b) => a.start - b.start);
  const out: Slot[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

export function subtractSlots(base: Slot, busy: Slot[]): Slot[] {
  const out: Slot[] = [];
  let cursor = base.start;
  for (const b of mergeSlots(busy)) {
    if (b.end <= cursor) continue;
    if (b.start >= base.end) break;
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, base.end) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < base.end) out.push({ start: cursor, end: base.end });
  return out;
}

export interface FreeSlotOptions {
  exclude?: Set<string>;
  extraBusy?: Slot[];
  buffer?: number;
  minLength?: number;
}

/** Belirli bir gündeki meşgul aralıklar (iş bloğu + saati olan görevler). */
export function busyIntervals(
  date: string,
  settings: PlannerSettings,
  tasks: PlannerTask[],
  opts: FreeSlotOptions = {},
): Slot[] {
  const buffer = opts.buffer ?? DEFAULT_BUFFER;
  const busy: Slot[] = [];
  const wb = workBlock(date, settings);
  if (wb) busy.push(wb);
  for (const t of tasks) {
    if (t.date !== date || !occupiesTime(t.status)) continue;
    if (opts.exclude?.has(t.id)) continue;
    const s = taskSlot(t);
    if (!s) continue;
    busy.push({ start: s.start - buffer, end: s.end + buffer });
  }
  for (const s of opts.extraBusy ?? []) busy.push({ start: s.start - buffer, end: s.end + buffer });
  return mergeSlots(busy);
}

/** Uyanık olunan süre içinde boş dilimler. */
export function freeSlots(
  date: string,
  settings: PlannerSettings,
  tasks: PlannerTask[],
  opts: FreeSlotOptions = {},
): Slot[] {
  const minLength = opts.minLength ?? MIN_SLOT;
  const bounds = dayBounds(settings);
  const busy = busyIntervals(date, settings, tasks, opts);
  return subtractSlots(bounds, busy).filter((s) => s.end - s.start >= minLength);
}

export function totalFreeMinutes(slots: Slot[]): number {
  return slots.reduce((a, s) => a + (s.end - s.start), 0);
}

export interface FindSlotOptions {
  /** Tercih edilen pencere (önce burada aranır) */
  preferredWindow?: Slot | null;
  /** Bu dakikadan önce başlamasın */
  notBefore?: number;
  /** En geç başlama dakikası */
  latestStart?: number;
  /** Tercih edilen başlangıç (yakınlık tercih edilir) */
  near?: number;
}

/** Verilen süreye uygun ilk/uygun başlangıç dakikasını döndürür. */
export function findSlot(slots: Slot[], duration: number, opts: FindSlotOptions = {}): number | null {
  const candidates: number[] = [];
  for (const s of slots) {
    const start = Math.max(s.start, opts.notBefore ?? 0);
    if (opts.latestStart !== undefined && start > opts.latestStart) continue;
    if (s.end - start >= duration) candidates.push(start);
  }
  if (candidates.length === 0) return null;

  if (opts.preferredWindow) {
    const pw = opts.preferredWindow;
    for (const s of slots) {
      const start = Math.max(s.start, pw.start, opts.notBefore ?? 0);
      const end = Math.min(s.end, pw.end);
      if (end - start >= duration && (opts.latestStart === undefined || start <= opts.latestStart)) return start;
    }
  }
  if (opts.near !== undefined) {
    const near = opts.near;
    // Hedefe en yakın; aynı dilim içinde hedefin kendisini dene
    let best: number | null = null;
    let bestDist = Infinity;
    for (const s of slots) {
      const lo = Math.max(s.start, opts.notBefore ?? 0);
      const hi = s.end - duration;
      if (hi < lo) continue;
      const pick = Math.min(Math.max(near, lo), hi);
      if (opts.latestStart !== undefined && pick > opts.latestStart) continue;
      const dist = Math.abs(pick - near);
      if (dist < bestDist) {
        bestDist = dist;
        best = pick;
      }
    }
    if (best !== null) return best;
  }
  return candidates[0];
}

export interface Conflict {
  a: PlannerTask;
  b: PlannerTask;
  overlapMinutes: number;
}

/** Aynı gün, saat çakışan görev çiftleri. */
export function detectConflicts(tasks: PlannerTask[]): Conflict[] {
  const out: Conflict[] = [];
  const timed = tasks.filter((t) => t.startTime && occupiesTime(t.status));
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (a.date !== b.date) continue;
      const sa = taskSlot(a)!;
      const sb = taskSlot(b)!;
      const overlap = Math.min(sa.end, sb.end) - Math.max(sa.start, sb.start);
      if (overlap > 0) out.push({ a, b, overlapMinutes: overlap });
    }
  }
  return out;
}

/** Yerleştirme için sıralama: öncelik, son tarih, zaman türü, zorluk. */
export function sortForPlacement<T extends Pick<PlannerTask, "priority" | "deadline" | "timeType" | "difficulty">>(
  tasks: T[],
): T[] {
  return [...tasks].sort((x, y) => {
    const p = PRIORITY_RANK[y.priority] - PRIORITY_RANK[x.priority];
    if (p) return p;
    const dx = x.deadline ?? "9999-12-31";
    const dy = y.deadline ?? "9999-12-31";
    if (dx !== dy) return dx < dy ? -1 : 1;
    const t = TIME_TYPE_RANK[y.timeType] - TIME_TYPE_RANK[x.timeType];
    if (t) return t;
    return y.difficulty - x.difficulty;
  });
}

export interface Placement<T> {
  item: T;
  startTime: string;
}

export interface PlaceResult<T> {
  placed: Placement<T>[];
  unplaced: T[];
  remainingFree: number;
}

/**
 * Adayları bir günün boş dilimlerine yerleştirir.
 * Zor görevler odak penceresine; OPTIONAL görevler ancak dinlenme payı korunursa yerleşir.
 */
export function placeOnDay<T extends PlannerTask>(
  date: string,
  settings: PlannerSettings,
  existing: PlannerTask[],
  candidates: T[],
  opts: { reserveRest?: number; exclude?: Set<string>; extraBusy?: Slot[]; buffer?: number } = {},
): PlaceResult<T> {
  const reserveRest = opts.reserveRest ?? settings.dailyFreeMinutes;
  const buffer = opts.buffer ?? DEFAULT_BUFFER;
  const working: PlannerTask[] = existing.filter((t) => !(opts.exclude?.has(t.id)));
  const placed: Placement<T>[] = [];
  const unplaced: T[] = [];
  const focus = focusWindow(settings);
  const extra = [...(opts.extraBusy ?? [])];

  for (const cand of sortForPlacement(candidates)) {
    const slots = freeSlots(date, settings, working, { extraBusy: extra, buffer });
    const free = totalFreeMinutes(slots);
    const needsReserve = cand.timeType === "OPTIONAL" || cand.priority === "LOW";
    if (needsReserve && free - cand.durationMinutes - buffer < reserveRest) {
      unplaced.push(cand);
      continue;
    }
    const preferFocus = cand.difficulty >= 3 || cand.timeType === "PRIORITY";
    const start = findSlot(slots, cand.durationMinutes, {
      preferredWindow: preferFocus ? focus : null,
      near: cand.startTime ? toMinutes(cand.startTime) : undefined,
    });
    if (start === null) {
      unplaced.push(cand);
      continue;
    }
    const startTime = toHHMM(start);
    placed.push({ item: cand, startTime });
    working.push({ ...cand, date, startTime, status: "PLANNED" });
  }
  const remainingFree = totalFreeMinutes(freeSlots(date, settings, working, { extraBusy: extra, buffer }));
  return { placed, unplaced, remainingFree };
}

export function slotToText(s: Slot): string {
  return `${toHHMM(s.start)}-${toHHMM(s.end)}`;
}
