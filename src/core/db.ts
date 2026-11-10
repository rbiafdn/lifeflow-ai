// Tarayıcı içi veri katmanı. Tüm veri tek bir JSON belgesi olarak saklanır
// (tarayıcıda localStorage, testlerde bellek). Sunucu yoktur; her şey bu cihazda kalır.

import type { Priority, TimeType, TaskStatus, Frequency, HabitStatus, GoalStatus, SettingsDTO, CategoryDTO, TaskDTO, PreviewLine } from "../shared/types";
import { DEFAULT_CATEGORIES } from "../shared/defaults";

export const STORAGE_KEY = "lifeflow-db-v1";

export interface TaskRec extends TaskDTO {}

export interface RecurrenceRec {
  id: string;
  categoryId: string | null;
  title: string;
  notes: string | null;
  startTime: string | null;
  durationMinutes: number;
  priority: Priority;
  timeType: TimeType;
  flexibility: number;
  difficulty: number;
  frequency: Frequency;
  weekdays: number[];
  interval: number;
  startDate: string;
  endDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HabitRec {
  id: string;
  categoryId: string | null;
  name: string;
  icon: string;
  frequency: Frequency;
  weekdays: number[];
  dailyTarget: number;
  weeklyTarget: number;
  active: boolean;
  createdAt: string;
  archivedAt: string | null;
}

export interface HabitLogRec {
  id: string;
  habitId: string;
  date: string;
  status: HabitStatus;
  value: number;
  note: string | null;
  createdAt: string;
}

export interface GoalRec {
  id: string;
  categoryId: string | null;
  title: string;
  description: string | null;
  area: string;
  targetDate: string | null;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneRec {
  id: string;
  goalId: string;
  title: string;
  done: boolean;
  sortOrder: number;
  doneAt: string | null;
}

export interface NoteRec {
  id: string;
  goalId: string | null;
  kind: "note" | "vocab" | "topic";
  title: string;
  content: string;
  tags: string[];
  mastered: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateRec {
  id: string;
  name: string;
  kind: "DAY" | "WEEK";
  payload: unknown;
  createdAt: string;
}

export interface ChangeSetRec {
  id: string;
  description: string;
  source: "USER" | "AI" | "SYSTEM";
  forward: unknown;
  inverse: unknown;
  undone: boolean;
  createdAt: string;
}

export interface ProposalRec {
  id: string;
  summary: string;
  rationale: string;
  operations: unknown;
  preview: { lines: PreviewLine[]; warnings: string[] };
  status: "PENDING" | "APPLIED" | "REJECTED" | "EXPIRED";
  createdAt: string;
  resolvedAt: string | null;
}

export interface WeeklyReviewRec {
  weekStart: string;
  content: string;
  stats: unknown;
  createdAt: string;
}

export interface SleepLogRec {
  id: string;
  date: string;
  bedTime: string;
  wakeTime: string;
  minutes: number;
  quality: number;
}

export interface AiConfig {
  apiKey: string;
  model: string;
  dailyLimit: number;
}

export interface Database {
  version: 1;
  profile: { name: string; createdAt: string };
  settings: SettingsDTO;
  categories: CategoryDTO[];
  tasks: TaskRec[];
  recurrences: RecurrenceRec[];
  habits: HabitRec[];
  habitLogs: HabitLogRec[];
  goals: GoalRec[];
  milestones: MilestoneRec[];
  notes: NoteRec[];
  templates: TemplateRec[];
  changeSets: ChangeSetRec[];
  proposals: ProposalRec[];
  aiUsage: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
  weeklyReviews: WeeklyReviewRec[];
  sleepLogs: SleepLogRec[];
  ai: AiConfig;
}

export interface StorageAdapter {
  read(): string | null;
  write(value: string): void;
  remove(): void;
}

export class MemoryStorage implements StorageAdapter {
  private v: string | null = null;
  read() {
    return this.v;
  }
  write(value: string) {
    this.v = value;
  }
  remove() {
    this.v = null;
  }
}

export class BrowserStorage implements StorageAdapter {
  read() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
  write(value: string) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      console.error("Veri kaydedilemedi", e);
    }
  }
  remove() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* yok say */
    }
  }
}

export function defaultSettings(): SettingsDTO {
  return {
    wakeTime: "07:00",
    sleepTime: "23:30",
    workStart: "09:00",
    workEnd: "18:00",
    workDays: [1, 2, 3, 4, 5],
    commuteMinutes: 30,
    dailyFreeMinutes: 60,
    focusStart: "19:00",
    focusEnd: "22:00",
    sportDays: [1, 3, 5],
    restDays: [0],
    weeklyGoals: {},
    notifications: { email: false, push: false, dailySummary: true },
    timezone: "Europe/Istanbul",
    theme: "system",
  };
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function emptyDatabase(): Database {
  const createdAt = nowIso();
  return {
    version: 1,
    profile: { name: "Sen", createdAt },
    settings: defaultSettings(),
    categories: DEFAULT_CATEGORIES.map((c, i) => ({ id: newId(), ...c, isDefault: true, sortOrder: i })),
    tasks: [],
    recurrences: [],
    habits: [],
    habitLogs: [],
    goals: [],
    milestones: [],
    notes: [],
    templates: [],
    changeSets: [],
    proposals: [],
    aiUsage: {},
    weeklyReviews: [],
    sleepLogs: [],
    ai: { apiKey: "", model: "claude-opus-5-5", dailyLimit: 60 },
  };
}

let storage: StorageAdapter = typeof localStorage !== "undefined" ? new BrowserStorage() : new MemoryStorage();
let cache: Database | null = null;

export function useStorage(adapter: StorageAdapter) {
  storage = adapter;
  cache = null;
}

export function db(): Database {
  if (cache) return cache;
  const raw = storage.read();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Database>;
      cache = { ...emptyDatabase(), ...parsed, settings: { ...defaultSettings(), ...(parsed.settings ?? {}) }, ai: { ...emptyDatabase().ai, ...(parsed.ai ?? {}) } };
      return cache;
    } catch (e) {
      console.error("Kayıtlı veri okunamadı, sıfırdan başlanıyor", e);
    }
  }
  cache = emptyDatabase();
  storage.write(JSON.stringify(cache));
  return cache;
}

/** Değişiklikten sonra çağrılır; tüm veriyi kalıcı depoya yazar. */
export function save() {
  if (!cache) return;
  if (cache.changeSets.length > 300) cache.changeSets = cache.changeSets.slice(-300);
  storage.write(JSON.stringify(cache));
}

export function resetDatabase() {
  storage.remove();
  cache = null;
  db();
}

export function replaceDatabase(next: Database) {
  cache = next;
  save();
}

export class CoreError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = "Kayıt") => new CoreError(404, `${what} bulunamadı.`);
export const badRequest = (msg: string, details?: unknown) => new CoreError(400, msg, details);

export type { TaskStatus };
