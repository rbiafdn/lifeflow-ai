// Yeniden planlama senaryoları. Her senaryo doğrulanabilir operasyon listesi + gerekçe üretir.
// Veritabanına dokunmaz; sonuçlar kullanıcı onayından sonra uygulanır.

import { addDays, toMinutes, toHHMM, weekStart, dateRange, formatDateTR, daysBetween } from "../../shared/time";
import type { Operation, TaskInput } from "../../shared/types";
import {
  type PlannerTask,
  type PlannerSettings,
  type Slot,
  freeSlots,
  findSlot,
  placeOnDay,
  taskSlot,
  totalFreeMinutes,
  sortForPlacement,
  PRIORITY_RANK,
  detectConflicts,
  slotToText,
  focusWindow,
  isWorkDay,
  DEFAULT_BUFFER,
} from "./slots";

export interface PlannerContext {
  today: string;
  settings: PlannerSettings;
  tasks: PlannerTask[];
  restCategoryId?: string | null;
}

export interface ReplanResult {
  operations: Operation[];
  explanation: string[];
  affected: PlannerTask[];
  warnings: string[];
}

function empty(): ReplanResult {
  return { operations: [], explanation: [], affected: [], warnings: [] };
}

function isMovable(t: PlannerTask): boolean {
  return t.timeType !== "FIXED" && t.flexibility > 0;
}

/** Görevin esnekliğine göre taşınabileceği son tarih. */
function latestDateFor(t: PlannerTask, from: string): string {
  if (t.flexibility <= 1) return from;
  if (t.flexibility === 2) return addDays(weekStart(from), 6);
  return t.deadline ?? addDays(from, 14);
}

function toTaskInput(t: PlannerTask, overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    title: t.title,
    notes: t.notes ?? null,
    categoryId: t.categoryId,
    date: t.date,
    startTime: t.startTime,
    durationMinutes: t.durationMinutes,
    priority: t.priority,
    timeType: t.timeType,
    flexibility: t.flexibility,
    deadline: t.deadline,
    difficulty: t.difficulty,
    goalId: t.goalId ?? null,
    ...overrides,
  };
}

/**
 * Bir görevi belirli günlerde (sırayla) uygun bir dilime yerleştirmeye çalışır.
 * `working` listesi, önceki yerleşimleri de hesaba katmak için güncellenir.
 */
function findPlacementAcrossDays(
  ctx: PlannerContext,
  task: PlannerTask,
  dates: string[],
  working: PlannerTask[],
  opts: { near?: number; notBefore?: number; extraBusy?: Record<string, Slot[]> } = {},
): { date: string; startTime: string } | null {
  for (const date of dates) {
    if (task.deadline && date > task.deadline) break;
    const slots = freeSlots(date, ctx.settings, working, {
      exclude: new Set([task.id]),
      extraBusy: opts.extraBusy?.[date],
    });
    const notBefore = date === ctx.today && opts.notBefore !== undefined ? opts.notBefore : undefined;
    const preferFocus = task.difficulty >= 3 || task.timeType === "PRIORITY";
    const start = findSlot(slots, task.durationMinutes, {
      near: opts.near,
      notBefore,
      preferredWindow: preferFocus && opts.near === undefined ? focusWindow(ctx.settings) : null,
    });
    if (start !== null) {
      const startTime = toHHMM(start);
      working.push({ ...task, date, startTime, status: "PLANNED" });
      return { date, startTime };
    }
  }
  return null;
}

/* ---------------------------------------------------------------- */
/* Senaryo: görevi taşı                                                */
/* ---------------------------------------------------------------- */

export function moveTask(
  ctx: PlannerContext,
  task: PlannerTask,
  targetDate: string,
  targetTime?: string | null,
): ReplanResult {
  const r = empty();
  r.affected.push(task);
  if (!isMovable(task)) {
    r.warnings.push(`"${task.title}" sabit bir görev; taşıma kullanıcı isteğiyle yapılıyor.`);
  }
  const working = ctx.tasks.filter((t) => t.id !== task.id);
  let startTime: string | null = targetTime ?? null;

  if (startTime) {
    const s = toMinutes(startTime);
    const probe: PlannerTask = { ...task, date: targetDate, startTime, status: "PLANNED" };
    const conflicts = detectConflicts([...working.filter((t) => t.date === targetDate), probe]).filter(
      (c) => c.a.id === task.id || c.b.id === task.id,
    );
    if (conflicts.length) {
      const other = conflicts[0].a.id === task.id ? conflicts[0].b : conflicts[0].a;
      const slots = freeSlots(targetDate, ctx.settings, working);
      const alt = findSlot(slots, task.durationMinutes, { near: s });
      if (alt !== null) {
        r.warnings.push(
          `${formatDateTR(targetDate)} ${startTime} saati "${other.title}" ile çakışıyor; en yakın boş saat ${toHHMM(alt)} seçildi.`,
        );
        startTime = toHHMM(alt);
      } else {
        r.warnings.push(`${formatDateTR(targetDate)} ${startTime} "${other.title}" ile çakışıyor ve o gün başka boş dilim yok.`);
      }
    }
  } else if (task.startTime) {
    const slots = freeSlots(targetDate, ctx.settings, working);
    const alt = findSlot(slots, task.durationMinutes, { near: toMinutes(task.startTime) });
    if (alt === null) {
      r.warnings.push(`${formatDateTR(targetDate)} günü için uygun boş dilim bulunamadı; görev saatsiz olarak taşındı.`);
    } else startTime = toHHMM(alt);
  }

  r.operations.push({
    type: "update",
    taskId: task.id,
    changes: { date: targetDate, startTime, postponeCount: task.postponeCount + (targetDate !== task.date ? 1 : 0) },
    reason: `Kullanıcı isteğiyle ${formatDateTR(targetDate)}${startTime ? " " + startTime : ""} tarihine taşındı.`,
  });
  r.explanation.push(
    `"${task.title}" ${formatDateTR(task.date)}${task.startTime ? " " + task.startTime : ""} → ${formatDateTR(targetDate)}${startTime ? " " + startTime : ""}.`,
  );
  return r;
}

/* ---------------------------------------------------------------- */
/* Senaryo B: görevi ertele (dakika)                                  */
/* ---------------------------------------------------------------- */

export function postponeTask(ctx: PlannerContext, task: PlannerTask, minutes: number): ReplanResult {
  const r = empty();
  r.affected.push(task);
  if (!task.startTime) {
    // Saatsiz görev: sadece bir sonraki güne alınabilir
    const next = addDays(task.date, 1);
    r.operations.push({
      type: "update",
      taskId: task.id,
      changes: { date: next, postponeCount: task.postponeCount + 1 },
      reason: "Saatsiz görev bir sonraki güne ertelendi.",
    });
    r.explanation.push(`"${task.title}" ${formatDateTR(next)} tarihine ertelendi.`);
    return r;
  }
  const wanted = toMinutes(task.startTime) + minutes;
  const working = ctx.tasks.filter((t) => t.id !== task.id);
  const slots = freeSlots(task.date, ctx.settings, working);
  const exact = slots.some((s) => s.start <= wanted && s.end >= wanted + task.durationMinutes);
  let newStart: number | null = exact ? wanted : findSlot(slots, task.durationMinutes, { notBefore: wanted });
  let newDate = task.date;
  if (newStart === null) {
    const placement = findPlacementAcrossDays(ctx, task, [addDays(task.date, 1), addDays(task.date, 2)], working, {
      near: toMinutes(task.startTime),
    });
    if (!placement) {
      r.warnings.push("Yakın günlerde uygun boş dilim bulunamadı; görev saatsiz olarak ertelendi.");
      r.operations.push({
        type: "update",
        taskId: task.id,
        changes: { date: addDays(task.date, 1), startTime: null, postponeCount: task.postponeCount + 1 },
      });
      return r;
    }
    newDate = placement.date;
    newStart = toMinutes(placement.startTime);
    r.warnings.push(`Aynı gün ${toHHMM(wanted)} sonrasında boş dilim yok; ${formatDateTR(newDate)} ${placement.startTime} önerildi.`);
  } else if (!exact) {
    r.warnings.push(`${toHHMM(wanted)} saati dolu; aynı gün ilk uygun saat ${toHHMM(newStart)} seçildi.`);
  }
  r.operations.push({
    type: "update",
    taskId: task.id,
    changes: { date: newDate, startTime: toHHMM(newStart), postponeCount: task.postponeCount + 1 },
    reason: `${minutes} dakika ertelendi.`,
  });
  r.explanation.push(`"${task.title}" ${task.startTime} → ${formatDateTR(newDate, false)} ${toHHMM(newStart)}.`);
  return r;
}

/* ---------------------------------------------------------------- */
/* Senaryo C/D: bir zaman aralığını boşalt (misafir, ekstra iş)       */
/* ---------------------------------------------------------------- */

export interface FreeWindowOptions {
  /** Aralığı dolduracak yeni sabit görev (ör. "Misafir") */
  blockTitle?: string;
  blockCategoryId?: string | null;
  blockTimeType?: "FIXED" | "REST";
}

export function freeWindow(
  ctx: PlannerContext,
  date: string,
  startHHMM: string,
  endHHMM: string,
  opts: FreeWindowOptions = {},
): ReplanResult {
  const r = empty();
  const win: Slot = { start: toMinutes(startHHMM), end: toMinutes(endHHMM) };
  if (win.end <= win.start) win.end += 24 * 60;

  const dayTasks = ctx.tasks.filter((t) => t.date === date && t.status === "PLANNED");
  const overlapping = dayTasks.filter((t) => {
    const s = taskSlot(t);
    return s && s.start < win.end && s.end > win.start;
  });
  r.affected.push(...overlapping);

  const fixed = overlapping.filter((t) => !isMovable(t));
  const movable = overlapping.filter(isMovable);
  for (const f of fixed) {
    r.warnings.push(`"${f.title}" (${f.startTime}) sabit bir görev; ${startHHMM}-${endHHMM} aralığıyla çakışıyor, izin olmadan taşınmadı.`);
  }

  if (opts.blockTitle) {
    r.operations.push({
      type: "create",
      task: {
        title: opts.blockTitle,
        date,
        startTime: startHHMM,
        durationMinutes: win.end - win.start,
        timeType: opts.blockTimeType ?? "FIXED",
        priority: "HIGH",
        flexibility: 0,
        categoryId: opts.blockCategoryId ?? null,
        difficulty: 1,
      },
      reason: `${startHHMM}-${endHHMM} aralığı "${opts.blockTitle}" için ayrıldı.`,
    });
  }

  const working = ctx.tasks.filter((t) => !movable.some((m) => m.id === t.id));
  const extraBusy: Record<string, Slot[]> = { [date]: [win] };

  // Önce dinlenme dışındakileri önem sırasına göre, dinlenmeyi en son ama mutlaka dene
  const rest = movable.filter((t) => t.timeType === "REST");
  const others = sortForPlacement(movable.filter((t) => t.timeType !== "REST"));

  for (const t of others) {
    const dates = dateRange(date, latestDateFor(t, date));
    const placement = findPlacementAcrossDays(ctx, t, dates, working, {
      near: t.startTime ? toMinutes(t.startTime) : undefined,
      extraBusy,
    });
    if (placement) {
      r.operations.push({
        type: "update",
        taskId: t.id,
        changes: {
          date: placement.date,
          startTime: placement.startTime,
          postponeCount: t.postponeCount + (placement.date !== date ? 1 : 0),
        },
        reason: `${startHHMM}-${endHHMM} aralığı boşaltıldığı için taşındı.`,
      });
      r.explanation.push(
        `"${t.title}" ${t.startTime} → ${placement.date === date ? "" : formatDateTR(placement.date, false) + " "}${placement.startTime}.`,
      );
    } else {
      // Esneklik izin vermiyorsa bir sonraki güne, uyarıyla
      const fallbackDates = dateRange(addDays(date, 1), addDays(date, 7));
      const fb = findPlacementAcrossDays(ctx, t, fallbackDates, working, { extraBusy });
      if (fb) {
        r.warnings.push(`"${t.title}" aynı gün sığmadı; ${formatDateTR(fb.date)} ${fb.startTime} önerildi (esneklik sınırı aşıldı).`);
        r.operations.push({
          type: "update",
          taskId: t.id,
          changes: { date: fb.date, startTime: fb.startTime, postponeCount: t.postponeCount + 1 },
          reason: "Aynı gün boş dilim kalmadı.",
        });
      } else {
        r.warnings.push(`"${t.title}" için uygun dilim bulunamadı; görev ertelendi olarak işaretlendi.`);
        r.operations.push({ type: "update", taskId: t.id, changes: { status: "POSTPONED", postponeCount: t.postponeCount + 1 } });
      }
    }
  }

  // Dinlenme: aynı gün küçültülerek de olsa korunmaya çalışılır
  for (const t of rest) {
    const slots = freeSlots(date, ctx.settings, working, { extraBusy: extraBusy[date], exclude: new Set([t.id]) });
    let dur = t.durationMinutes;
    let start: number | null = null;
    while (dur >= 30 && start === null) {
      start = findSlot(slots, dur, { near: t.startTime ? toMinutes(t.startTime) : undefined });
      if (start === null) dur -= 15;
    }
    if (start !== null) {
      const changes: Operation & { type: "update" } = {
        type: "update",
        taskId: t.id,
        changes: { startTime: toHHMM(start), durationMinutes: dur },
        reason: dur < t.durationMinutes ? "Dinlenme süresi kısaltılarak korundu." : "Dinlenme aynı gün korundu.",
      };
      r.operations.push(changes);
      working.push({ ...t, startTime: toHHMM(start), durationMinutes: dur });
      r.explanation.push(`Dinlenme ${t.startTime} → ${toHHMM(start)}${dur < t.durationMinutes ? ` (${dur} dk)` : ""}.`);
    } else {
      r.warnings.push("Dinlenme zamanı aynı gün korunamadı; en az 30 dakikalık boşluk kalmadı.");
    }
  }

  if (overlapping.length === 0) r.explanation.push(`${formatDateTR(date)} ${startHHMM}-${endHHMM} aralığında çakışan görev yok.`);
  return r;
}

/* ---------------------------------------------------------------- */
/* Senaryo A: görevi yapamadım                                        */
/* ---------------------------------------------------------------- */

export function markFailedAndReschedule(
  ctx: PlannerContext,
  task: PlannerTask,
  reschedule: boolean,
): ReplanResult {
  const r = empty();
  r.affected.push(task);
  r.operations.push({ type: "update", taskId: task.id, changes: { status: "FAILED" }, reason: "Kullanıcı görevi yapamadığını bildirdi." });
  r.explanation.push(`"${task.title}" (${formatDateTR(task.date, false)}) yapılamadı olarak kaydedildi.`);
  if (!reschedule) return r;

  const working = [...ctx.tasks];
  const from = task.date >= ctx.today ? addDays(task.date, 1) : ctx.today;
  const dates = dateRange(from, addDays(from, 6));
  const copy: PlannerTask = { ...task, id: "__copy__" + task.id, status: "PLANNED" };
  const placement = findPlacementAcrossDays(ctx, copy, dates, working, {
    near: task.startTime ? toMinutes(task.startTime) : undefined,
  });
  if (placement) {
    r.operations.push({
      type: "create",
      task: toTaskInput(task, { date: placement.date, startTime: placement.startTime }),
      reason: "Yapılamayan görev için yeni zaman.",
    });
    r.explanation.push(`Yeni zaman: ${formatDateTR(placement.date)} ${placement.startTime}.`);
  } else {
    r.warnings.push("Önümüzdeki 7 gün içinde uygun boş dilim bulunamadı; görev saatsiz olarak ertesi güne eklendi.");
    r.operations.push({ type: "create", task: toTaskInput(task, { date: from, startTime: null }) });
  }
  return r;
}

/* ---------------------------------------------------------------- */
/* Senaryo F: haftayı hafiflet                                        */
/* ---------------------------------------------------------------- */

export function lightenWeek(ctx: PlannerContext, anyDateInWeek: string, opts: { keepCategoryIds?: string[] } = {}): ReplanResult {
  const r = empty();
  const ws = weekStart(anyDateInWeek);
  const we = addDays(ws, 6);
  const nextWs = addDays(ws, 7);
  const weekTasks = ctx.tasks.filter((t) => t.date >= ws && t.date <= we && t.date >= ctx.today && t.status === "PLANNED");
  const working = ctx.tasks.filter((t) => !weekTasks.some((w) => w.id === t.id));
  const keep = new Set(opts.keepCategoryIds ?? []);

  const removable = weekTasks.filter(
    (t) =>
      isMovable(t) &&
      t.timeType !== "REST" &&
      !keep.has(t.categoryId ?? "") &&
      PRIORITY_RANK[t.priority] <= 2 &&
      (t.timeType === "OPTIONAL" || t.priority === "LOW" || (t.priority === "MEDIUM" && t.difficulty >= 3)),
  );
  const stays = weekTasks.filter((t) => !removable.some((x) => x.id === t.id));
  working.push(...stays);
  r.affected.push(...removable);

  for (const t of removable) {
    if (t.timeType === "OPTIONAL" && t.postponeCount >= 2) {
      r.operations.push({ type: "update", taskId: t.id, changes: { status: "CANCELLED" }, reason: "Opsiyonel görev, 2+ kez ertelenmişti; hafifletme için iptal önerildi." });
      r.explanation.push(`"${t.title}" iptal edildi (opsiyonel, ${t.postponeCount} kez ertelenmiş).`);
      continue;
    }
    const sameWeekday = addDays(t.date, 7);
    const placement = findPlacementAcrossDays(ctx, t, [sameWeekday, ...dateRange(nextWs, addDays(nextWs, 6)).filter((d) => d !== sameWeekday)], working, {
      near: t.startTime ? toMinutes(t.startTime) : undefined,
    });
    if (placement) {
      r.operations.push({
        type: "update",
        taskId: t.id,
        changes: { date: placement.date, startTime: placement.startTime, postponeCount: t.postponeCount + 1 },
        reason: "Hafif hafta için gelecek haftaya alındı.",
      });
      r.explanation.push(`"${t.title}" → ${formatDateTR(placement.date)} ${placement.startTime}.`);
    } else {
      r.operations.push({ type: "update", taskId: t.id, changes: { date: sameWeekday, startTime: null, postponeCount: t.postponeCount + 1 } });
      r.warnings.push(`"${t.title}" gelecek hafta için saat bulunamadı; saatsiz taşındı.`);
    }
  }

  // Dinlenme payı az olan günlere dinlenme bloğu ekle
  for (const date of dateRange(ws > ctx.today ? ws : ctx.today, we)) {
    const slots = freeSlots(date, ctx.settings, working);
    const free = totalFreeMinutes(slots);
    const hasRest = working.some((t) => t.date === date && t.timeType === "REST" && t.status === "PLANNED");
    if (hasRest) continue;
    if (free >= ctx.settings.dailyFreeMinutes + 60) {
      const start = findSlot(slots, 60, { preferredWindow: { start: 20 * 60, end: 23 * 60 } });
      if (start !== null) {
        r.operations.push({
          type: "create",
          task: {
            title: "Dinlenme",
            date,
            startTime: toHHMM(start),
            durationMinutes: 60,
            timeType: "REST",
            priority: "MEDIUM",
            flexibility: 1,
            categoryId: ctx.restCategoryId ?? null,
            difficulty: 1,
          },
          reason: "Hafif hafta için korunan dinlenme zamanı.",
        });
        working.push({
          id: "__rest__" + date, title: "Dinlenme", date, startTime: toHHMM(start), durationMinutes: 60,
          priority: "MEDIUM", timeType: "REST", flexibility: 1, deadline: null, status: "PLANNED",
          categoryId: null, difficulty: 1, postponeCount: 0,
        });
      }
    }
  }
  if (removable.length === 0) r.explanation.push("Bu hafta hafifletilebilecek düşük öncelikli görev bulunmuyor; sadece dinlenme blokları eklendi.");
  else r.explanation.unshift(`${removable.length} düşük öncelikli görev gelecek haftaya alındı; yüksek öncelikli ve sabit görevler korundu.`);
  return r;
}

/* ---------------------------------------------------------------- */
/* Senaryo G/H: biriken görevler, geride kalma                        */
/* ---------------------------------------------------------------- */

export function catchUp(
  ctx: PlannerContext,
  opts: { horizonDays?: number; maxBacklogPerDay?: number; aggressive?: boolean } = {},
): ReplanResult {
  const r = empty();
  const horizon = opts.horizonDays ?? 7;
  const perDayCap = opts.maxBacklogPerDay ?? Math.max(60, Math.round(ctx.settings.dailyFreeMinutes * 1.5));
  const backlog = sortForPlacement(ctx.tasks.filter((t) => t.date < ctx.today && (t.status === "PLANNED" || t.status === "POSTPONED")));
  if (backlog.length === 0) {
    r.explanation.push("Biriken görev yok.");
    return r;
  }
  r.affected.push(...backlog);
  const working = ctx.tasks.filter((t) => !backlog.some((b) => b.id === t.id));
  const dates = dateRange(ctx.today, addDays(ctx.today, horizon - 1));
  const usedPerDay: Record<string, number> = {};
  let cancelled = 0;
  let moved = 0;

  for (const t of backlog) {
    const lowValue = t.timeType === "OPTIONAL" || t.priority === "LOW";
    const stale = daysBetween(t.date, ctx.today) > 14;
    if (lowValue && (t.postponeCount >= 2 || stale || opts.aggressive)) {
      r.operations.push({ type: "update", taskId: t.id, changes: { status: "CANCELLED" }, reason: "Düşük öncelikli ve biriken görev; gerçekçi plan için iptal önerildi." });
      cancelled++;
      continue;
    }
    if (t.deadline && t.deadline < ctx.today) {
      r.warnings.push(`"${t.title}" son tarihi (${t.deadline}) geçmiş; yine de en erken boşluğa alındı.`);
    }
    const candidateDates = dates.filter((d) => (usedPerDay[d] ?? 0) + t.durationMinutes <= perDayCap);
    const placement = findPlacementAcrossDays(ctx, { ...t, deadline: null }, candidateDates, working, {
      near: t.startTime ? toMinutes(t.startTime) : undefined,
    });
    if (placement) {
      usedPerDay[placement.date] = (usedPerDay[placement.date] ?? 0) + t.durationMinutes;
      r.operations.push({
        type: "update",
        taskId: t.id,
        changes: { date: placement.date, startTime: placement.startTime, status: "PLANNED", postponeCount: t.postponeCount + 1 },
        reason: "Biriken görev telafi planına alındı.",
      });
      moved++;
    } else if (lowValue) {
      r.operations.push({ type: "update", taskId: t.id, changes: { status: "CANCELLED" }, reason: "Telafi ufkunda yer kalmadı." });
      cancelled++;
    } else {
      r.operations.push({ type: "update", taskId: t.id, changes: { status: "POSTPONED", postponeCount: t.postponeCount + 1 } });
      r.warnings.push(`"${t.title}" ${horizon} gün içinde yer bulamadı; ertelendi olarak işaretlendi. Daha uzun bir ufuk deneyin.`);
    }
  }
  r.explanation.push(`${backlog.length} biriken görev: ${moved} tanesi önümüzdeki ${horizon} güne dağıtıldı (günde en çok ${perDayCap} dk), ${cancelled} düşük öncelikli görev iptal önerildi.`);
  return r;
}

/* ---------------------------------------------------------------- */
/* Boş günü planla                                                    */
/* ---------------------------------------------------------------- */

export interface Suggestion {
  title: string;
  categoryId: string | null;
  durationMinutes: number;
  priority: PlannerTask["priority"];
  timeType: PlannerTask["timeType"];
  difficulty: number;
  goalId?: string | null;
  reason: string;
}

export function planDay(ctx: PlannerContext, date: string, suggestions: Suggestion[], opts: { includeBacklog?: boolean } = {}): ReplanResult {
  const r = empty();
  const existing = ctx.tasks.filter((t) => t.date === date && t.status === "PLANNED");
  const working = [...ctx.tasks];
  const backlog = opts.includeBacklog === false ? [] : sortForPlacement(
    ctx.tasks.filter((t) => t.date < ctx.today && t.status === "PLANNED" && isMovable(t)),
  ).slice(0, 3);

  const candidates: PlannerTask[] = [
    ...backlog,
    ...suggestions.map<PlannerTask>((s, i) => ({
      id: "__sug__" + i,
      title: s.title,
      date,
      startTime: null,
      durationMinutes: s.durationMinutes,
      priority: s.priority,
      timeType: s.timeType,
      flexibility: 1,
      deadline: null,
      status: "PLANNED",
      categoryId: s.categoryId,
      difficulty: s.difficulty,
      postponeCount: 0,
      goalId: s.goalId ?? null,
      notes: s.reason,
    })),
  ];
  const result = placeOnDay(date, ctx.settings, working, candidates, { exclude: new Set(backlog.map((b) => b.id)) });
  for (const p of result.placed) {
    if (p.item.id.startsWith("__sug__")) {
      const s = suggestions[Number(p.item.id.slice(7))];
      r.operations.push({
        type: "create",
        task: {
          title: s.title,
          categoryId: s.categoryId,
          date,
          startTime: p.startTime,
          durationMinutes: s.durationMinutes,
          priority: s.priority,
          timeType: s.timeType,
          flexibility: 1,
          difficulty: s.difficulty,
          goalId: s.goalId ?? null,
        },
        reason: s.reason,
      });
    } else {
      r.affected.push(p.item);
      r.operations.push({
        type: "update",
        taskId: p.item.id,
        changes: { date, startTime: p.startTime, postponeCount: p.item.postponeCount + 1 },
        reason: "Biriken görev boş güne alındı.",
      });
    }
    r.explanation.push(`${p.startTime} ${p.item.title} (${p.item.durationMinutes} dk)`);
  }
  if (existing.length) r.explanation.unshift(`${formatDateTR(date)} gününde zaten ${existing.length} görev var; boşluklara yerleştirildi.`);
  if (result.unplaced.length) r.warnings.push(`${result.unplaced.length} öneri gün içine sığmadı: ${result.unplaced.map((u) => u.title).join(", ")}.`);
  r.explanation.push(`Kalan boş zaman: ${result.remainingFree} dk (dinlenme payı: ${ctx.settings.dailyFreeMinutes} dk).`);
  return r;
}

/* ---------------------------------------------------------------- */
/* Yardımcı: gün özeti (AI bağlamı için)                              */
/* ---------------------------------------------------------------- */

export function describeDay(ctx: PlannerContext, date: string): string {
  const slots = freeSlots(date, ctx.settings, ctx.tasks);
  const parts = [
    isWorkDay(date, ctx.settings)
      ? `iş ${ctx.settings.workStart}-${ctx.settings.workEnd} (+${ctx.settings.commuteMinutes} dk yol)`
      : "iş günü değil",
    `boş: ${slots.map(slotToText).join(", ") || "yok"} (toplam ${totalFreeMinutes(slots)} dk)`,
  ];
  return parts.join("; ");
}

export { DEFAULT_BUFFER };
