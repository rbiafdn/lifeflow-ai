// Sunucu ve istemci arasında paylaşılan tipler.

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type TimeType = "FIXED" | "FLEXIBLE" | "PRIORITY" | "OPTIONAL" | "REST";
export type TaskStatus = "PLANNED" | "DONE" | "SKIPPED" | "CANCELLED" | "FAILED" | "POSTPONED";
export type Frequency = "DAILY" | "WEEKLY";
export type HabitStatus = "DONE" | "SKIPPED" | "POSTPONED";
export type GoalStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";

export const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const TIME_TYPES: TimeType[] = ["FIXED", "FLEXIBLE", "PRIORITY", "OPTIONAL", "REST"];
export const TASK_STATUSES: TaskStatus[] = ["PLANNED", "DONE", "SKIPPED", "CANCELLED", "FAILED", "POSTPONED"];

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Düşük",
  MEDIUM: "Orta",
  HIGH: "Yüksek",
  CRITICAL: "Kritik",
};

export const TIME_TYPE_LABELS: Record<TimeType, string> = {
  FIXED: "Sabit",
  FLEXIBLE: "Esnek",
  PRIORITY: "Öncelikli",
  OPTIONAL: "Opsiyonel",
  REST: "Dinlenme",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  PLANNED: "Planlandı",
  DONE: "Tamamlandı",
  SKIPPED: "Atlandı",
  CANCELLED: "İptal",
  FAILED: "Yapılamadı",
  POSTPONED: "Ertelendi",
};

export const FLEXIBILITY_LABELS: Record<number, string> = {
  0: "Taşınamaz",
  1: "Aynı gün içinde",
  2: "Aynı hafta içinde",
  3: "Serbest",
};

export interface TaskDTO {
  id: string;
  userId: string;
  categoryId: string | null;
  title: string;
  notes: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  durationMinutes: number;
  priority: Priority;
  timeType: TimeType;
  flexibility: number;
  deadline: string | null;
  status: TaskStatus;
  difficulty: number;
  postponeCount: number;
  completedAt: string | null;
  recurrenceId: string | null;
  seriesDate: string | null;
  detached: boolean;
  goalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDTO {
  id: string;
  name: string;
  color: string;
  icon: string;
  isDefault: boolean;
  weeklyTargetMinutes: number;
  sortOrder: number;
}

export interface SettingsDTO {
  wakeTime: string;
  sleepTime: string;
  workStart: string;
  workEnd: string;
  workDays: number[];
  commuteMinutes: number;
  dailyFreeMinutes: number;
  focusStart: string;
  focusEnd: string;
  sportDays: number[];
  restDays: number[];
  weeklyGoals: Record<string, number>;
  notifications: { email: boolean; push: boolean; dailySummary: boolean };
  timezone: string;
  theme: string;
}

export interface TaskInput {
  title: string;
  notes?: string | null;
  categoryId?: string | null;
  date: string;
  startTime?: string | null;
  durationMinutes?: number;
  priority?: Priority;
  timeType?: TimeType;
  flexibility?: number;
  deadline?: string | null;
  difficulty?: number;
  goalId?: string | null;
}

export type TaskPatch = Partial<TaskInput> & { status?: TaskStatus; postponeCount?: number };

/** Doğrulanmış arka uç operasyonları. AI ve yeniden planlama motoru yalnızca bunları üretir. */
export type Operation =
  | { type: "create"; task: TaskInput; reason?: string }
  | { type: "update"; taskId: string; changes: TaskPatch; reason?: string }
  | { type: "delete"; taskId: string; reason?: string };

export interface PreviewLine {
  kind: "create" | "update" | "delete";
  taskId?: string;
  title: string;
  before?: string;
  after?: string;
  reason?: string;
  warning?: string;
}

export interface ProposalDTO {
  id: string;
  summary: string;
  rationale: string;
  operations: Operation[];
  preview: PreviewLine[];
  warnings: string[];
  status: "PENDING" | "APPLIED" | "REJECTED" | "EXPIRED";
  createdAt: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
