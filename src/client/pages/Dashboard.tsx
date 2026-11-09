import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Sparkles, ArrowRight, Undo2, AlertTriangle, CalendarClock } from "lucide-react";
import { api } from "../lib/api";
import { useStore, errorText } from "../lib/store";
import { useTasks } from "../lib/useTasks";
import { TaskItem } from "../components/TaskItem";
import { TaskForm } from "../components/TaskForm";
import { ProposalPanel } from "../components/ProposalPanel";
import { Progress } from "../components/ui";
import type { TaskDTO } from "@shared/types";
import { todayLocal, addDays, formatDateTR, toMinutes, weekStart } from "@shared/time";

interface HabitRow {
  id: string;
  name: string;
  streak: number;
  weekDone: number;
  weeklyTarget: number;
  frequency: "DAILY" | "WEEKLY";
  logs: { date: string; status: string }[];
}

interface WeekStats {
  completionRate: number;
  byCategory: { categoryId: string | null; name: string; color: string; minutesDone: number; weeklyTarget: number }[];
}

export function DashboardPage() {
  const { user, settings, toast } = useStore();
  const nav = useNavigate();
  const today = todayLocal();
  const t = useTasks(today, addDays(today, 3));
  const [editing, setEditing] = useState<TaskDTO | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [habits, setHabits] = useState<HabitRow[]>([]);
  const [week, setWeek] = useState<WeekStats | null>(null);
  const [backlog, setBacklog] = useState<TaskDTO[]>([]);
  const [ask, setAsk] = useState("");

  const loadSide = async () => {
    try {
      const [h, w, b] = await Promise.all([
        api.get<{ habits: HabitRow[] }>(`/api/habits?from=${addDays(today, -6)}&to=${today}`),
        api.get<WeekStats>(`/api/stats?range=week&date=${today}`),
        api.get<{ tasks: TaskDTO[] }>("/api/tasks?backlog=1"),
      ]);
      setHabits(h.habits);
      setWeek(w);
      setBacklog(b.tasks);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  useEffect(() => {
    loadSide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  const todays = useMemo(() => t.tasks.filter((x) => x.date === today).sort(sortByTime), [t.tasks, today]);
  const upcoming = useMemo(() => t.tasks.filter((x) => x.date > today && x.status === "PLANNED" && (x.timeType === "FIXED" || x.priority === "HIGH" || x.priority === "CRITICAL")).slice(0, 5), [t.tasks, today]);
  const active = todays.filter((x) => x.status !== "CANCELLED");
  const done = active.filter((x) => x.status === "DONE").length;
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const next = todays.find((x) => x.status === "PLANNED" && (!x.startTime || toMinutes(x.startTime) + x.durationMinutes > nowMin));
  const totalMin = active.filter((x) => x.status === "DONE").reduce((a, x) => a + x.durationMinutes, 0);

  const actions = { ...t.actions, onEdit: (task: TaskDTO) => { setEditing(task); setFormOpen(true); } };

  async function logHabit(h: HabitRow) {
    const doneToday = h.logs.some((l) => l.date === today && l.status === "DONE");
    try {
      if (doneToday) await api.delete(`/api/habits/${h.id}/log/${today}`);
      else await api.post(`/api/habits/${h.id}/log`, { date: today, status: "DONE" });
      await loadSide();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
  const ws = weekStart(today);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
            {greeting}, {user?.name?.split(" ")[0]}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">{formatDateTR(today)} · {summaryLine(active.length, done, totalMin, next)}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={t.undo} title="Son değişikliği geri al">
            <Undo2 size={16} />
          </button>
          <button className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus size={16} /> Görev
          </button>
        </div>
      </div>

      <form
        className="card flex items-center gap-2 p-2 pl-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ask.trim()) nav("/asistan", { state: { message: ask.trim() } });
        }}
      >
        <Sparkles size={18} className="shrink-0 text-brand-600" />
        <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" placeholder="Asistana sor: “Yarın için program hazırla”, “Sporu perşembeye taşı”…" value={ask} onChange={(e) => setAsk(e.target.value)} />
        <button className="btn-primary px-3 py-1.5" type="submit">
          <ArrowRight size={16} />
        </button>
      </form>

      {backlog.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <span className="inline-flex items-center gap-2">
            <AlertTriangle size={16} /> {backlog.length} görev geçmiş günlerde planlı kaldı.
          </span>
          <button className="btn-secondary py-1.5" onClick={() => t.runScenario({ scenario: "catch_up", horizonDays: 7 }, "Biriken görevler için telafi planı")}>
            <CalendarClock size={15} /> Telafi planı oluştur
          </button>
        </div>
      )}

      {t.pending && <ProposalPanel p={{ summary: t.pending.description, explanation: t.pending.explanation, preview: t.pending.preview, warnings: t.pending.warnings }} onApply={async () => { await t.applyPending(); loadSide(); }} onReject={() => t.setPending(null)} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Bugünün programı</h2>
              <span className="text-xs text-slate-500">
                {done}/{active.length} tamamlandı
              </span>
            </div>
            <Progress value={active.length ? (done / active.length) * 100 : 0} color="bg-emerald-500" />
            <div className="mt-3 space-y-2">
              {t.loading ? (
                <p className="py-6 text-center text-sm text-slate-500">Yükleniyor…</p>
              ) : todays.length === 0 ? (
                <div className="py-6 text-center text-sm text-slate-500">
                  Bugün için görev yok.{" "}
                  <button className="font-medium text-brand-600 hover:underline" onClick={() => t.runScenario({ scenario: "plan_day", date: today }, "Bugünü planla")}>
                    Günü otomatik planla
                  </button>
                </div>
              ) : (
                todays.map((task) => <TaskItem key={task.id} t={task} actions={actions} conflict={t.conflictIds.has(task.id)} />)
              )}
            </div>
          </div>

          {next && (
            <div className="card flex items-center justify-between gap-3 p-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Sıradaki</div>
                <div className="text-sm font-semibold">{next.title}</div>
                <div className="text-xs text-slate-500">{next.startTime ? `${next.startTime} – ${next.endTime}` : "Saatsiz"} · {next.durationMinutes} dk</div>
              </div>
              <button className="btn-secondary" onClick={() => t.actions.onToggleDone(next)}>
                Tamamla
              </button>
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <div className="card p-4">
            <h2 className="mb-2 text-sm font-semibold">Alışkanlıklar</h2>
            {habits.length === 0 ? (
              <p className="text-xs text-slate-500">
                Henüz alışkanlık yok.{" "}
                <button className="text-brand-600 hover:underline" onClick={() => nav("/aliskanliklar")}>
                  Ekle
                </button>
              </p>
            ) : (
              <ul className="space-y-1.5">
                {habits.slice(0, 6).map((h) => {
                  const doneToday = h.logs.some((l) => l.date === today && l.status === "DONE");
                  return (
                    <li key={h.id} className="flex items-center justify-between gap-2 text-sm">
                      <button onClick={() => logHabit(h)} className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${doneToday ? "text-slate-400 line-through" : ""}`}>
                        <span className={`h-4 w-4 shrink-0 rounded border ${doneToday ? "border-emerald-500 bg-emerald-500" : "border-slate-300 dark:border-slate-600"}`} />
                        <span className="truncate">{h.name}</span>
                      </button>
                      <span className="text-[11px] text-slate-500">🔥 {h.streak}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-sm font-semibold">Haftalık hedefler</h2>
            {week && week.byCategory.filter((c) => c.weeklyTarget > 0).length > 0 ? (
              <ul className="space-y-2">
                {week.byCategory
                  .filter((c) => c.weeklyTarget > 0)
                  .slice(0, 6)
                  .map((c) => (
                    <li key={c.categoryId ?? "none"}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span>{c.name}</span>
                        <span className="text-slate-500">
                          {c.minutesDone}/{c.weeklyTarget} dk
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (c.minutesDone / c.weeklyTarget) * 100)}%`, background: c.color }} />
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">Bu hafta ({formatDateTR(ws, false)}) henüz hedef kategorilerinde tamamlanan görev yok. Hedefleri Ayarlar › Kategoriler'den belirleyebilirsin.</p>
            )}
            {week && <p className="mt-3 text-xs text-slate-500">Haftalık tamamlama oranı: %{week.completionRate}</p>}
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-sm font-semibold">Yaklaşanlar</h2>
            {upcoming.length === 0 ? (
              <p className="text-xs text-slate-500">Önümüzdeki 3 günde sabit/önemli etkinlik yok.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {upcoming.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{u.title}</span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {formatDateTR(u.date, false)} {u.startTime ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {settings && (
            <p className="px-1 text-[11px] text-slate-400">
              Uyanma {settings.wakeTime} · Uyku {settings.sleepTime} · İş {settings.workStart}-{settings.workEnd}
            </p>
          )}
        </aside>
      </div>

      <TaskForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => { t.reload(); loadSide(); }} task={editing} defaults={{ date: today }} />
    </div>
  );
}

function sortByTime(a: TaskDTO, b: TaskDTO) {
  if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
  if (a.startTime) return -1;
  if (b.startTime) return 1;
  return 0;
}

function summaryLine(total: number, done: number, minutes: number, next?: TaskDTO) {
  if (total === 0) return "Bugün planlı görev yok.";
  if (done === total) return `Bugünün ${total} görevini tamamladın (${minutes} dk). 🎉`;
  return `${total} görev, ${done} tamamlandı${next ? ` · sıradaki: ${next.title}` : ""}`;
}
