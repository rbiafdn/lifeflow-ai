// Veritabanı ile saf planlama motoru arasındaki köprü.

import { z } from "zod";
import { prisma } from "../db";
import { notFound, badRequest } from "../lib/errors";
import { parse } from "../lib/validate";
import { dateSchema, timeSchema } from "./schemas";
import { toPlannerTask, validateOperations } from "./operations";
import { restCategoryId } from "./seed";
import { materialize } from "./recurrence";
import { addDays, todayLocal, weekStart } from "../../shared/time";
import type { PlannerContext, ReplanResult, Suggestion } from "../planner/replan";
import * as replan from "../planner/replan";
import { freeSlots, slotToText, totalFreeMinutes, type PlannerSettings } from "../planner/slots";

export async function loadSettings(userId: string): Promise<PlannerSettings> {
  const s = await prisma.userSettings.upsert({ where: { userId }, update: {}, create: { userId } });
  return s;
}

export async function buildContext(userId: string, from: string, to: string, today = todayLocal()): Promise<PlannerContext> {
  await materialize(userId, from, to);
  const [settings, tasks, restId] = await Promise.all([
    loadSettings(userId),
    prisma.task.findMany({ where: { userId, date: { gte: from, lte: to } }, orderBy: [{ date: "asc" }, { startTime: "asc" }] }),
    restCategoryId(userId),
  ]);
  return { today, settings, tasks: tasks.map(toPlannerTask), restCategoryId: restId };
}

export const scenarioSchema = z.discriminatedUnion("scenario", [
  z.object({ scenario: z.literal("move"), taskId: z.string(), targetDate: dateSchema, targetTime: timeSchema.nullable().optional() }),
  z.object({ scenario: z.literal("postpone"), taskId: z.string(), minutes: z.number().int().min(5).max(24 * 60) }),
  z.object({
    scenario: z.literal("free_window"),
    date: dateSchema,
    start: timeSchema,
    end: timeSchema,
    blockTitle: z.string().max(100).optional(),
    blockTimeType: z.enum(["FIXED", "REST"]).optional(),
  }),
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
export async function autoSuggestions(userId: string, date: string): Promise<Suggestion[]> {
  const ws = weekStart(date);
  const we = addDays(ws, 6);
  const [categories, weekTasks, goals, restId] = await Promise.all([
    prisma.category.findMany({ where: { userId, weeklyTargetMinutes: { gt: 0 } } }),
    prisma.task.findMany({ where: { userId, date: { gte: ws, lte: we }, status: { in: ["PLANNED", "DONE"] } } }),
    prisma.goal.findMany({ where: { userId, status: "ACTIVE" }, include: { milestones: { where: { done: false }, orderBy: { sortOrder: "asc" }, take: 1 } } }),
    restCategoryId(userId),
  ]);
  const minutesByCat = new Map<string, number>();
  for (const t of weekTasks) if (t.categoryId) minutesByCat.set(t.categoryId, (minutesByCat.get(t.categoryId) ?? 0) + t.durationMinutes);
  const gaps = categories
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
  for (const g of goals.slice(0, 2)) {
    const m = g.milestones[0];
    out.push({
      title: m ? `${g.title}: ${m.title}` : g.title,
      categoryId: g.categoryId,
      durationMinutes: 45,
      priority: "MEDIUM",
      timeType: "PRIORITY",
      difficulty: 3,
      goalId: g.id,
      reason: `"${g.title}" hedefinde sıradaki adım.`,
    });
  }
  out.push({
    title: "Dinlenme",
    categoryId: restId,
    durationMinutes: 60,
    priority: "MEDIUM",
    timeType: "REST",
    difficulty: 1,
    reason: "Korunan dinlenme zamanı.",
  });
  return out;
}

export interface ScenarioOutcome extends ReplanResult {
  preview: Awaited<ReturnType<typeof validateOperations>>["preview"];
  affectedIds: string[];
}

export async function runScenario(userId: string, raw: unknown, today = todayLocal()): Promise<ScenarioOutcome> {
  const input = parse(scenarioSchema, raw);
  const from = addDays(today, -21);
  const to = addDays(today, 28);
  const ctx = await buildContext(userId, from, to, today);
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
      result = replan.freeWindow(ctx, input.date, input.start, input.end, {
        blockTitle: input.blockTitle,
        blockTimeType: input.blockTimeType,
      });
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
        ? input.suggestions.map((s) => ({
            title: s.title,
            categoryId: s.categoryId ?? null,
            durationMinutes: s.durationMinutes,
            priority: s.priority ?? "MEDIUM",
            timeType: s.timeType ?? "FLEXIBLE",
            difficulty: s.difficulty ?? 2,
            goalId: s.goalId ?? null,
            reason: s.reason ?? "",
          }))
        : await autoSuggestions(userId, input.date);
      result = replan.planDay(ctx, input.date, suggestions, { includeBacklog: input.includeBacklog });
      break;
    }
    default:
      throw badRequest("Bilinmeyen senaryo");
  }

  const preview = result.operations.length ? (await validateOperations(userId, result.operations)).preview : [];
  return { ...result, preview, affectedIds: result.affected.map((a) => a.id) };
}

export async function freeSlotsFor(userId: string, date: string, durationMinutes?: number) {
  const ctx = await buildContext(userId, date, date);
  const slots = freeSlots(date, ctx.settings, ctx.tasks).filter((s) => !durationMinutes || s.end - s.start >= durationMinutes);
  return { date, slots: slots.map((s) => ({ ...s, text: slotToText(s) })), totalFree: totalFreeMinutes(slots), summary: replan.describeDay(ctx, date) };
}
