import { z } from "zod";
import { isValidDate, isValidHHMM } from "../../shared/time";
import { PRIORITIES, TIME_TYPES, TASK_STATUSES } from "../../shared/types";

export const dateSchema = z.string().refine(isValidDate, "YYYY-MM-DD biçiminde olmalı");
export const timeSchema = z.string().refine(isValidHHMM, "HH:mm biçiminde olmalı");
export const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const timeTypeSchema = z.enum(["FIXED", "FLEXIBLE", "PRIORITY", "OPTIONAL", "REST"]);
export const statusSchema = z.enum(["PLANNED", "DONE", "SKIPPED", "CANCELLED", "FAILED", "POSTPONED"]);
void PRIORITIES;
void TIME_TYPES;
void TASK_STATUSES;

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Başlık gerekli").max(200),
  notes: z.string().max(5000).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  date: dateSchema,
  startTime: timeSchema.nullable().optional(),
  durationMinutes: z.number().int().min(5).max(24 * 60).optional(),
  priority: prioritySchema.optional(),
  timeType: timeTypeSchema.optional(),
  flexibility: z.number().int().min(0).max(3).optional(),
  deadline: dateSchema.nullable().optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  goalId: z.string().nullable().optional(),
});

export const taskPatchSchema = taskInputSchema.partial().extend({
  status: statusSchema.optional(),
  postponeCount: z.number().int().min(0).optional(),
});

export const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), task: taskInputSchema, reason: z.string().max(500).optional(), id: z.string().optional() }),
  z.object({ type: z.literal("update"), taskId: z.string(), changes: taskPatchSchema, reason: z.string().max(500).optional() }),
  z.object({ type: z.literal("delete"), taskId: z.string(), reason: z.string().max(500).optional() }),
]);

export const operationsSchema = z.array(operationSchema).min(1).max(200);

export const recurrenceInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(5000).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  startTime: timeSchema.nullable().optional(),
  durationMinutes: z.number().int().min(5).max(24 * 60).default(30),
  priority: prioritySchema.default("MEDIUM"),
  timeType: timeTypeSchema.default("FLEXIBLE"),
  flexibility: z.number().int().min(0).max(3).default(1),
  difficulty: z.number().int().min(1).max(5).default(2),
  frequency: z.enum(["DAILY", "WEEKLY"]).default("WEEKLY"),
  weekdays: z.array(z.number().int().min(0).max(6)).default([]),
  interval: z.number().int().min(1).max(12).default(1),
  startDate: dateSchema,
  endDate: dateSchema.nullable().optional(),
  active: z.boolean().optional(),
});

export const settingsSchema = z.object({
  wakeTime: timeSchema.optional(),
  sleepTime: timeSchema.optional(),
  workStart: timeSchema.optional(),
  workEnd: timeSchema.optional(),
  workDays: z.array(z.number().int().min(0).max(6)).optional(),
  commuteMinutes: z.number().int().min(0).max(300).optional(),
  dailyFreeMinutes: z.number().int().min(0).max(600).optional(),
  focusStart: timeSchema.optional(),
  focusEnd: timeSchema.optional(),
  sportDays: z.array(z.number().int().min(0).max(6)).optional(),
  restDays: z.array(z.number().int().min(0).max(6)).optional(),
  weeklyGoals: z.record(z.string(), z.number().min(0)).optional(),
  notifications: z.object({ email: z.boolean(), push: z.boolean(), dailySummary: z.boolean() }).optional(),
  timezone: z.string().max(64).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(40).optional(),
  weeklyTargetMinutes: z.number().int().min(0).max(10000).optional(),
  sortOrder: z.number().int().optional(),
});

export const habitSchema = z.object({
  name: z.string().trim().min(1).max(100),
  categoryId: z.string().nullable().optional(),
  icon: z.string().max(40).optional(),
  frequency: z.enum(["DAILY", "WEEKLY"]).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  dailyTarget: z.number().int().min(1).max(50).optional(),
  weeklyTarget: z.number().int().min(1).max(7).optional(),
  active: z.boolean().optional(),
});

export const habitLogSchema = z.object({
  date: dateSchema,
  status: z.enum(["DONE", "SKIPPED", "POSTPONED"]).default("DONE"),
  value: z.number().int().min(0).max(100).optional(),
  note: z.string().max(500).nullable().optional(),
});

export const goalSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  area: z.string().max(40).optional(),
  categoryId: z.string().nullable().optional(),
  targetDate: dateSchema.nullable().optional(),
  status: z.enum(["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]).optional(),
  milestones: z.array(z.string().trim().min(1).max(200)).optional(),
});

export const milestoneSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  done: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const noteSchema = z.object({
  goalId: z.string().nullable().optional(),
  kind: z.enum(["note", "vocab", "topic"]).optional(),
  title: z.string().trim().min(1).max(200),
  content: z.string().max(20000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  mastered: z.boolean().optional(),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["DAY", "WEEK"]),
  sourceDate: dateSchema,
});

export const sleepLogSchema = z.object({
  date: dateSchema,
  bedTime: timeSchema,
  wakeTime: timeSchema,
  quality: z.number().int().min(1).max(5).optional(),
});
