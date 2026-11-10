// Veri katmanı ile saf planlama motoru arasındaki köprü.

import { z } from "zod";
import { db, notFound, badRequest } from "./db";
import { parse } from "./validate";
import { dateSchema, timeSchema } from "./schemas";
import { toPlannerTask, validateOperations } from "./operations";
import { materialize } from "./recurrence";
import { addDays, todayLocal, weekStart } from "../shared/time";
import type { PlannerContext, ReplanResult, Suggestion } from "../shared/planner/replan";
import * as replan from "../shared/planner/replan";
import { freeSlots, slotToText, totalFreeMinutes } from "../shared/planner/slots";

export function restCategoryId(): string | null {
  return db().categories.find((c) => c.name === "Dinlenme")?.id ?? null;
}

export function buildContext(from: string, to: string, today = todayLocal()): PlannerContext {
  materialize(from, to);
  const d = db();
  const tasks = d.tasks.filter((t) => t.date >= from && t.date <= to).sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "99").localeCompare(b.startTime ?? "99"));
  return { today, settings: d.settings, tasks: tasks.map(toPlannerTask), restCategoryId: restCategoryId() };
}

export const scenarioSchema = z.discriminatedUnion("scenario", [
  z.object({ scenario: z.literal("move"), taskId: z.string(), targetDate: dateSchema, targetTime: timeSchema.nullable().optional() }),
  z.object({ scenario: z.literal("postpone"), taskId: z.string(), minutes: z.number().int().min(5).max(24 * 60) }),
  z.object({ scenario: z.literal("free_window"), date: dateSchema, start: timeSchema, end: timeSchema, blockTitle: z.string().max(100).optional(), blockTimeType: z.enum(["FIXED", "REST"]).optional() }),
  z.object({ scenario: z.literal("failed"), taskId: z.string(), reschedule: z.boolean().default(true) }),
  z.object({ scenario: z.literal("lighten_week"), date: dateSchema.optional(), keepCategoryIds: z.array(z.string()).optional() }),
  z.object({ scenario: z.literal("catch_up"), horizonDays: z.number().int().min(1).max(30).optional(), aggressive: z.boolean().optional() }),
  z.object({
    scenario: z.literal("plan_day"),
    date: dateSchema,
    suggestions: z
      .array(
        z.object({
          title: z.string().min(1).max(200),
          categoryId: z.string().nullable().optional(),
          durationMinutes: z.number().int().min(10).max(480),
          priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
          timeType: z.enum(["FIXED", "FLEXIBLE", "PRIORITY", "OPTIONAL", "REST"]).optional(),
          difficulty: z.number().int().min(1).max(5).optional(),
          goalId: z.string().nullable().optional(),
          reason: z.string().max(300).optional(),
        }),
      )
      .optional(),
    includeBacklog: z.boolean().optional(),
  }),
]);

export type ScenarioInput = z.infer<typeof scenarioSchema>;

/** Kategori hedefleri ve aktif hedeflerden otomatik öneriler. */
export function autoSuggestions(date: string): Suggestion[] {
  const d = db();
  const ws = weekStart(date);
  const we = addDays(ws, 6);
  const restId = restCategoryId();
  const minutesByCat = new Map<string, number>();
  for (const t of d.tasks) {
    if (t.date < ws || t.date > we || !(t.status === "PLANNED" || t.status === "DONE") || !t.categoryId) continue;
    minutesByCat.set(t.categoryId, (minutesByCat.get(t.categoryId) ?? 0) + t.durationMinutes);
  }
  const gaps = d.categories
    .filter((c) => c.weeklyTargetMinutes > 0)
    .map((c) => ({ c, gap: c.weeklyTargetMinutes - (minutesByCat.get(c.id) ?? 0) }))
    .filter((g) => g.gap > 0 && g.c.id !== restId)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 4);
  const out: Suggestion[] = gaps.map((g) => ({
    title: `${g.c.name} çalışması`,
    categoryId: g.c.id,
    durationMinutes: Math.max(30, Math.min(90, Math.round(g.gap / 15) * 15)),
    priority: g.gap >= 120 ? "HIGH" : "MEDIUM",
    timeType: "FLEXIBLE",
    difficulty: 3,
    reason: `Bu hafta "${g.c.name}" hedefinin ${g.gap} dakikası eksik.`,
  }));
  for (const g of d.goals.filter((x) => x.status === "ACTIVE").slice(0, 2)) {
    const m = d.milestones.filter((x) => x.goalId === g.id && !x.done).sort((a, b) => a.sortOrder - b.sortOrder)[0];
    out.push({ title: m ? `${g.title}: ${m.title}` : g.title, categoryId: g.categoryId, durationMinutes: 45, priority: "MEDIUM", timeType: "PRIORITY", difficulty: 3, goalId: g.id, reason: `"${g.title}" hedefinde sıradaki adım.` });
  }
  out.push({ title: "Dinlenme", categoryId: restId, durationMinutes: 60, priority: "MEDIUM", timeType: "REST", difficulty: 1, reason: "Korunan dinlenme zamanı." });
  return out;
}

export interface ScenarioOutcome extends ReplanResult {
  preview: ValidationPreview;
  affectedIds: string[];
}
type ValidationPreview = ReturnType<typeof validateOperations>["preview"];

export function runScenario(raw: unknown, today = todayLocal()): ScenarioOutcome {
  const input = parse(scenarioSchema, raw);
  const ctx = buildContext(addDays(today, -21), addDays(today, 28), today);
  const findTask = (id: string) => {
    const t = ctx.tasks.find((x) => x.id === id);
    if (!t) throw notFound(`Görev (${id})`);
    return t;
  };
  let result: ReplanResult;
  switch (input.scenario) {
    case "move":
      result = replan.moveTask(ctx, findTask(input.taskId), input.targetDate, input.targetTime ?? null);
      break;
    case "postpone":
      result = replan.postponeTask(ctx, findTask(input.taskId), input.minutes);
      break;
    case "free_window":
      result = replan.freeWindow(ctx, input.date, input.start, input.end, { blockTitle: input.blockTitle, blockTimeType: input.blockTimeType });
      break;
    case "failed":
      result = replan.markFailedAndReschedule(ctx, findTask(input.taskId), input.reschedule);
      break;
    case "lighten_week":
      result = replan.lightenWeek(ctx, input.date ?? today, { keepCategoryIds: input.keepCategoryIds });
      break;
    case "catch_up":
      result = replan.catchUp(ctx, { horizonDays: input.horizonDays, aggressive: input.aggressive });
      break;
    case "plan_day": {
      const suggestions: Suggestion[] = input.suggestions
        ? input.suggestions.map((s) => ({ title: s.title, categoryId: s.categoryId ?? null, durationMinutes: s.durationMinutes, priority: s.priority ?? "MEDIUM", timeType: s.timeType ?? "FLEXIBLE", difficulty: s.difficulty ?? 2, goalId: s.goalId ?? null, reason: s.reason ?? "" }))
        : autoSuggestions(input.date);
      result = replan.planDay(ctx, input.date, suggestions, { includeBacklog: input.includeBacklog });
      break;
    }
    default:
      throw badRequest("Bilinmeyen senaryo");
  }
  const preview = result.operations.length ? validateOperations(result.operations).preview : [];
  return { ...result, preview, affectedIds: result.affected.map((a) => a.id) };
}

export function freeSlotsFor(date: string, durationMinutes?: number) {
  const ctx = buildContext(date, date);
  const slots = freeSlots(date, ctx.settings, ctx.tasks).filter((s) => !durationMinutes || s.end - s.start >= durationMinutes);
  return { date, slots: slots.map((s) => ({ ...s, text: slotToText(s) })), totalFree: totalFreeMinutes(slots), summary: replan.describeDay(ctx, date) };
}
