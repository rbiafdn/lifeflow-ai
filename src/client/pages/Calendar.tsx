import { useMemo, useState, useRef, type DragEvent } from "react";
import { ChevronLeft, ChevronRight, Plus, Undo2, Redo2, Copy, LayoutTemplate, Users, Feather, CalendarClock, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import { useStore, errorText } from "../lib/store";
import { useTasks } from "../lib/useTasks";
import { TaskItem } from "../components/TaskItem";
import { TaskForm } from "../components/TaskForm";
import { ProposalPanel } from "../components/ProposalPanel";
import { Modal, Segmented, PageHeader } from "../components/ui";
import type { TaskDTO } from "@shared/types";
import { todayLocal, addDays, weekStart, monthStart, monthEnd, dateRange, weekday, toMinutes, toHHMM, formatDateTR, WEEKDAY_SHORT_TR, MONTH_NAMES_TR, parseDate } from "@shared/time";

type View = "day" | "week" | "month";
const HOUR_PX = 48;
const START_HOUR = 6;
const END_HOUR = 24;

export function CalendarPage() {
  const { settings, categoryById } = useStore();
  const today = todayLocal();
  const [view, setView] = useState<View>(() => (window.innerWidth < 768 ? "day" : "week"));
  const [anchor, setAnchor] = useState(today);

  const range = useMemo(() => {
    if (view === "day") return { from: anchor, to: anchor };
    if (view === "week") {
      const ws = weekStart(anchor);
      return { from: ws, to: addDays(ws, 6) };
    }
    const ms = monthStart(anchor);
    return { from: weekStart(ms), to: addDays(weekStart(monthEnd(anchor)), 6) };
  }, [view, anchor]);

  const t = useTasks(range.from, range.to);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskDTO | null>(null);
  const [defaults, setDefaults] = useState<Partial<TaskDTO>>({});
  const [tool, setTool] = useState<"guest" | "copy" | "template" | null>(null);

  const actions = { ...t.actions, onEdit: (task: TaskDTO) => { setEditing(task); setDefaults({}); setFormOpen(true); } };
  const openNew = (d: Partial<TaskDTO>) => { setEditing(null); setDefaults(d); setFormOpen(true); };

  function shift(dir: -1 | 1) {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, 7 * dir));
    else {
      const d = parseDate(monthStart(anchor));
      d.setUTCMonth(d.getUTCMonth() + dir);
      setAnchor(d.toISOString().slice(0, 10));
    }
  }

  const title =
    view === "day"
      ? formatDateTR(anchor)
      : view === "week"
        ? `${formatDateTR(range.from, false)} – ${formatDateTR(range.to, false)}`
        : `${MONTH_NAMES_TR[parseDate(anchor).getUTCMonth()]} ${anchor.slice(0, 4)}`;

  // Sürükle-bırak
  const dragId = useRef<string | null>(null);
  function onDragStart(e: DragEvent, task: TaskDTO) {
    dragId.current = task.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id);
  }
  async function dropOn(date: string, e: DragEvent, columnEl: HTMLElement | null) {
    e.preventDefault();
    const id = dragId.current ?? e.dataTransfer.getData("text/plain");
    const task = t.tasks.find((x) => x.id === id);
    dragId.current = null;
    if (!task) return;
    let startTime: string | null | undefined = undefined;
    if (columnEl) {
      const rect = columnEl.getBoundingClientRect();
      const y = e.clientY - rect.top + columnEl.scrollTop;
      const minutes = Math.round((START_HOUR * 60 + (y / HOUR_PX) * 60) / 15) * 15;
      startTime = toHHMM(Math.max(0, Math.min(23 * 60 + 45, minutes)));
    }
    if (task.date === date && startTime === task.startTime) return;
    await t.moveTo(task, date, columnEl ? startTime : task.startTime);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Takvim"
        actions={
          <>
            <Segmented value={view} onChange={setView} options={[{ value: "day", label: "Gün" }, { value: "week", label: "Hafta" }, { value: "month", label: "Ay" }]} />
            <button className="btn-secondary p-2" onClick={t.undo} title="Geri al">
              <Undo2 size={16} />
            </button>
            <button className="btn-secondary p-2" onClick={t.redo} title="Yeniden uygula">
              <Redo2 size={16} />
            </button>
            <button className="btn-primary" onClick={() => openNew({ date: view === "day" ? anchor : today })}>
              <Plus size={16} /> Görev
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button className="btn-ghost p-2" onClick={() => shift(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button className="btn-ghost text-sm font-semibold" onClick={() => setAnchor(today)}>
            {title}
          </button>
          <button className="btn-ghost p-2" onClick={() => shift(1)}>
            <ChevronRight size={18} />
          </button>
          {anchor !== today && (
            <button className="btn-ghost text-xs" onClick={() => setAnchor(today)}>
              Bugün
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ToolBtn icon={Users} label="Aralık boşalt" onClick={() => setTool("guest")} />
          <ToolBtn icon={Feather} label="Hafif hafta" onClick={() => t.runScenario({ scenario: "lighten_week", date: anchor }, "Hafif hafta planı")} />
          <ToolBtn icon={CalendarClock} label="Telafi" onClick={() => t.runScenario({ scenario: "catch_up", horizonDays: 7 }, "Biriken görevler için telafi planı")} />
          <ToolBtn icon={Wand2} label="Günü planla" onClick={() => t.runScenario({ scenario: "plan_day", date: view === "day" ? anchor : today }, `${view === "day" ? anchor : today} günü planlandı`)} />
          <ToolBtn icon={Copy} label="Kopyala" onClick={() => setTool("copy")} />
          <ToolBtn icon={LayoutTemplate} label="Şablon" onClick={() => setTool("template")} />
        </div>
      </div>

      {t.pending && <ProposalPanel p={{ summary: t.pending.description, explanation: t.pending.explanation, preview: t.pending.preview, warnings: t.pending.warnings }} onApply={t.applyPending} onReject={() => t.setPending(null)} />}

      {view === "month" ? (
        <MonthView range={range} anchor={anchor} tasks={t.tasks} today={today} onPick={(d) => { setAnchor(d); setView("day"); }} onDrop={(d, e) => dropOn(d, e, null)} onDragStart={onDragStart} />
      ) : (
        <div className="card overflow-hidden">
          <div className="flex overflow-x-auto">
            <div className="w-12 shrink-0 border-r border-slate-200 dark:border-slate-800">
              <div className="h-14 border-b border-slate-200 dark:border-slate-800" />
              <div className="h-10 border-b border-slate-200 dark:border-slate-800" />
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                <div key={i} className="relative text-[10px] text-slate-400" style={{ height: HOUR_PX }}>
                  <span className="absolute -top-1.5 right-1">{String(START_HOUR + i).padStart(2, "0")}:00</span>
                </div>
              ))}
            </div>
            {dateRange(range.from, range.to).map((date) => (
              <DayColumn
                key={date}
                date={date}
                today={today}
                tasks={t.tasks.filter((x) => x.date === date)}
                conflictIds={t.conflictIds}
                single={view === "day"}
                settings={settings}
                categoryColor={(id) => categoryById(id)?.color}
                onEdit={actions.onEdit}
                onNew={(d, time) => openNew({ date: d, startTime: time })}
                onDragStart={onDragStart}
                onDrop={dropOn}
                actions={actions}
              />
            ))}
          </div>
        </div>
      )}

      <TaskForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={t.reload} task={editing} defaults={defaults} />

      <GuestModal open={tool === "guest"} onClose={() => setTool(null)} date={view === "day" ? anchor : today} onRun={(body, desc) => { setTool(null); t.runScenario(body, desc); }} />
      <CopyModal open={tool === "copy"} onClose={() => setTool(null)} date={view === "day" ? anchor : today} onDone={() => { setTool(null); t.reload(); }} />
      <TemplateModal open={tool === "template"} onClose={() => setTool(null)} date={view === "day" ? anchor : today} onDone={() => { setTool(null); t.reload(); }} />
      <p className="text-[11px] text-slate-400">İpucu: görevleri sürükleyip bırakarak taşıyabilirsin (15 dk adımlarla). Boş bir saate tıklayarak görev ekle.</p>
    </div>
  );
}

function ToolBtn({ icon: Icon, label, onClick }: { icon: typeof Users; label: string; onClick: () => void }) {
  return (
    <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={onClick}>
      <Icon size={14} /> {label}
    </button>
  );
}

interface ColumnProps {
  date: string;
  today: string;
  tasks: TaskDTO[];
  conflictIds: Set<string>;
  single: boolean;
  settings: ReturnType<typeof useStore>["settings"];
  categoryColor: (id: string | null) => string | undefined;
  onEdit: (t: TaskDTO) => void;
  onNew: (date: string, time: string | null) => void;
  onDragStart: (e: DragEvent, t: TaskDTO) => void;
  onDrop: (date: string, e: DragEvent, el: HTMLElement | null) => void;
  actions: ReturnType<typeof useTasks>["actions"] & { onEdit: (t: TaskDTO) => void };
}

function DayColumn(p: ColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const timed = p.tasks.filter((x) => x.startTime);
  const untimed = p.tasks.filter((x) => !x.startTime);
  const isToday = p.date === p.today;
  const wd = weekday(p.date);
  const isWork = p.settings?.workDays.includes(wd);
  const workTop = p.settings && isWork ? ((toMinutes(p.settings.workStart) - START_HOUR * 60) / 60) * HOUR_PX : 0;
  const workH = p.settings && isWork ? ((toMinutes(p.settings.workEnd) - toMinutes(p.settings.workStart)) / 60) * HOUR_PX : 0;
  const sleepTop = p.settings ? ((toMinutes(p.settings.sleepTime) - START_HOUR * 60) / 60) * HOUR_PX : 0;
  const wakeH = p.settings ? ((toMinutes(p.settings.wakeTime) - START_HOUR * 60) / 60) * HOUR_PX : 0;
  const nowTop = isToday ? ((new Date().getHours() * 60 + new Date().getMinutes() - START_HOUR * 60) / 60) * HOUR_PX : -1;

  // Çakışan görevleri yan yana yerleştir
  const laid = useMemo(() => {
    const sorted = [...timed].sort((a, b) => toMinutes(a.startTime!) - toMinutes(b.startTime!));
    const cols: { end: number }[] = [];
    return sorted.map((task) => {
      const s = toMinutes(task.startTime!);
      const e = s + task.durationMinutes;
      let col = cols.findIndex((c) => c.end <= s);
      if (col === -1) {
        cols.push({ end: e });
        col = cols.length - 1;
      } else cols[col].end = e;
      return { task, s, e, col, total: 1 };
    }).map((x, _, arr) => ({ ...x, total: Math.max(...arr.filter((y) => y.s < x.e && y.e > x.s).map((y) => y.col + 1), 1) }));
  }, [timed]);

  return (
    <div className={`${p.single ? "flex-1" : "min-w-[140px] flex-1"} border-r border-slate-200 last:border-r-0 dark:border-slate-800`}>
      <div className={`flex h-14 flex-col items-center justify-center border-b border-slate-200 text-xs dark:border-slate-800 ${isToday ? "text-brand-600" : "text-slate-500"}`}>
        <span>{WEEKDAY_SHORT_TR[wd]}</span>
        <span className={`text-lg font-semibold ${isToday ? "rounded-full bg-brand-600 px-2 text-white" : ""}`}>{Number(p.date.slice(8))}</span>
      </div>
      <div
        className="min-h-10 border-b border-slate-200 p-1 dark:border-slate-800"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => p.onDrop(p.date, e, null)}
      >
        {untimed.map((task) =>
          p.single ? (
            <div key={task.id} className="mb-1" draggable onDragStart={(e) => p.onDragStart(e, task)}>
              <TaskItem t={task} actions={p.actions} compact conflict={p.conflictIds.has(task.id)} />
            </div>
          ) : (
            <button key={task.id} draggable onDragStart={(e) => p.onDragStart(e, task)} onClick={() => p.onEdit(task)} className={`mb-0.5 block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] ${task.status === "DONE" ? "line-through opacity-60" : ""}`} style={{ background: (p.categoryColor(task.categoryId) ?? "#64748b") + "22", color: p.categoryColor(task.categoryId) ?? "#334155" }}>
              {task.title}
            </button>
          ),
        )}
        {untimed.length === 0 && !p.single && <button className="h-8 w-full text-[10px] text-slate-300 hover:text-slate-500" onClick={() => p.onNew(p.date, null)}>+ saatsiz</button>}
      </div>
      <div
        ref={ref}
        className="relative"
        style={{ height: (END_HOUR - START_HOUR) * HOUR_PX }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => p.onDrop(p.date, e, ref.current)}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const minutes = Math.floor((START_HOUR * 60 + ((e.clientY - rect.top) / HOUR_PX) * 60) / 30) * 30;
          p.onNew(p.date, toHHMM(minutes));
        }}
      >
        {/* uyku ve iş gölgeleri */}
        {p.settings && wakeH > 0 && <div className="absolute inset-x-0 top-0 bg-slate-100/80 dark:bg-slate-800/60" style={{ height: wakeH }} />}
        {p.settings && <div className="absolute inset-x-0 bg-slate-100/80 dark:bg-slate-800/60" style={{ top: sleepTop, bottom: 0 }} />}
        {isWork && workH > 0 && (
          <div className="absolute inset-x-0 border-y border-dashed border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40" style={{ top: workTop, height: workH }}>
            <span className="px-1 text-[9px] uppercase tracking-wide text-slate-400">iş</span>
          </div>
        )}
        {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
          <div key={i} className="absolute inset-x-0 border-t border-slate-100 dark:border-slate-800/80" style={{ top: i * HOUR_PX }} onClick={() => p.onNew(p.date, toHHMM((START_HOUR + i) * 60))} />
        ))}
        {nowTop >= 0 && <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-red-500" style={{ top: nowTop }} />}
        {laid.map(({ task, s, e, col, total }) => {
          const color = p.categoryColor(task.categoryId) ?? "#6366f1";
          const top = ((s - START_HOUR * 60) / 60) * HOUR_PX;
          const h = Math.max(18, ((e - s) / 60) * HOUR_PX - 2);
          const width = 100 / total;
          const inactive = task.status === "CANCELLED" || task.status === "SKIPPED";
          const conflict = p.conflictIds.has(task.id);
          return (
            <div
              key={task.id}
              draggable
              onDragStart={(ev) => p.onDragStart(ev, task)}
              onClick={(ev) => {
                ev.stopPropagation();
                p.onEdit(task);
              }}
              className={`absolute z-10 cursor-grab overflow-hidden rounded-lg border-l-[3px] px-1.5 py-0.5 text-[11px] leading-tight shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing ${inactive ? "opacity-50" : ""} ${conflict ? "ring-2 ring-red-400" : ""}`}
              style={{ top, height: h, left: `${col * width}%`, width: `calc(${width}% - 4px)`, marginLeft: 2, background: color + (task.status === "DONE" ? "15" : "28"), borderColor: color, color: "inherit" }}
              title={`${task.title} ${task.startTime}–${task.endTime}`}
            >
              <div className={`truncate font-medium ${task.status === "DONE" ? "line-through" : ""}`}>{task.title}</div>
              {h > 28 && (
                <div className="truncate text-[10px] opacity-70">
                  {task.startTime}–{task.endTime}
                  {task.timeType === "FIXED" ? " · sabit" : ""}
                  {task.status !== "PLANNED" && task.status !== "DONE" ? ` · ${task.status === "FAILED" ? "yapılamadı" : task.status === "CANCELLED" ? "iptal" : task.status.toLowerCase()}` : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({ range, anchor, tasks, today, onPick, onDrop, onDragStart }: { range: { from: string; to: string }; anchor: string; tasks: TaskDTO[]; today: string; onPick: (d: string) => void; onDrop: (d: string, e: DragEvent) => void; onDragStart: (e: DragEvent, t: TaskDTO) => void }) {
  const { categoryById } = useStore();
  const month = anchor.slice(0, 7);
  const days = dateRange(range.from, range.to);
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-200 text-center text-[11px] text-slate-500 dark:border-slate-800">
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <div key={d} className="py-2">
            {WEEKDAY_SHORT_TR[d]}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = tasks.filter((t) => t.date === d && t.status !== "CANCELLED");
          const done = list.filter((t) => t.status === "DONE").length;
          const inMonth = d.startsWith(month);
          return (
            <div key={d} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(d, e)} className={`min-h-24 border-b border-r border-slate-100 p-1.5 dark:border-slate-800 ${inMonth ? "" : "bg-slate-50/60 text-slate-400 dark:bg-slate-900/40"}`}>
              <button onClick={() => onPick(d)} className={`mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${d === today ? "bg-brand-600 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                {Number(d.slice(8))}
              </button>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((t) => (
                  <div key={t.id} draggable onDragStart={(e) => onDragStart(e, t)} className={`truncate rounded px-1 text-[10px] ${t.status === "DONE" ? "line-through opacity-60" : ""}`} style={{ background: (categoryById(t.categoryId)?.color ?? "#64748b") + "22" }}>
                    {t.startTime ? `${t.startTime} ` : ""}
                    {t.title}
                  </div>
                ))}
                {list.length > 3 && <div className="text-[10px] text-slate-400">+{list.length - 3}</div>}
              </div>
              {list.length > 0 && (
                <div className="mt-1 text-[10px] text-slate-400">
                  {done}/{list.length}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GuestModal({ open, onClose, date, onRun }: { open: boolean; onClose: () => void; date: string; onRun: (body: Record<string, unknown>, desc: string) => void }) {
  const [d, setD] = useState(date);
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("23:00");
  const [title, setTitle] = useState("Misafir");
  const [kind, setKind] = useState<"FIXED" | "REST">("FIXED");
  return (
    <Modal open={open} onClose={onClose} title="Bir zaman aralığını boşalt">
      <p className="mb-3 text-xs text-slate-500">Misafir, ekstra iş veya ani plan değişikliği için. Aralıktaki esnek görevler uygun saatlere taşınır; sabit görevler izinsiz taşınmaz; dinlenme korunur.</p>
      <div className="space-y-3">
        <div>
          <label className="label">Tarih</label>
          <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Başlangıç</label>
            <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="label">Bitiş</label>
            <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Blok adı (boş bırakılabilir)</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Misafir / Ekstra iş" />
          </div>
          <div>
            <label className="label">Blok türü</label>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as "FIXED" | "REST")}>
              <option value="FIXED">Sabit (iş, misafir)</option>
              <option value="REST">Dinlenme</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button className="btn-primary" onClick={() => onRun({ scenario: "free_window", date: d, start, end, blockTitle: title || undefined, blockTimeType: kind }, `${d} ${start}-${end} aralığı boşaltıldı${title ? ` (${title})` : ""}`)}>
            Önizle
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CopyModal({ open, onClose, date, onDone }: { open: boolean; onClose: () => void; date: string; onDone: () => void }) {
  const { toast } = useStore();
  const [kind, setKind] = useState<"DAY" | "WEEK">("DAY");
  const [source, setSource] = useState(date);
  const [target, setTarget] = useState(addDays(date, 1));
  const [includeFixed, setIncludeFixed] = useState(true);
  async function run() {
    try {
      const r = await api.post<{ copied: number }>("/api/tasks/copy", { kind, sourceDate: source, targetDate: target, includeFixed });
      toast(`${r.copied} görev kopyalandı`, "success");
      onDone();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Gün / hafta kopyala">
      <div className="space-y-3">
        <Segmented value={kind} onChange={setKind} options={[{ value: "DAY", label: "Gün" }, { value: "WEEK", label: "Hafta" }]} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Kaynak</label>
            <input className="input" type="date" value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
          <div>
            <label className="label">Hedef</label>
            <input className="input" type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeFixed} onChange={(e) => setIncludeFixed(e.target.checked)} /> Sabit görevleri de kopyala
        </label>
        <p className="text-xs text-slate-500">Tekrarlayan seri örnekleri kopyalanmaz (zaten otomatik üretilir).</p>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button className="btn-primary" onClick={run}>
            Kopyala
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TemplateModal({ open, onClose, date, onDone }: { open: boolean; onClose: () => void; date: string; onDone: () => void }) {
  const { toast } = useStore();
  const [templates, setTemplates] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"DAY" | "WEEK">("DAY");
  const [source, setSource] = useState(date);
  const [target, setTarget] = useState(date);
  const loaded = useRef(false);
  if (open && !loaded.current) {
    loaded.current = true;
    api.get<{ templates: typeof templates }>("/api/templates").then((r) => setTemplates(r.templates)).catch(() => undefined);
  }
  if (!open && loaded.current) loaded.current = false;

  async function save() {
    try {
      await api.post("/api/templates", { name, kind, sourceDate: source });
      toast("Şablon kaydedildi", "success");
      const r = await api.get<{ templates: typeof templates }>("/api/templates");
      setTemplates(r.templates);
      setName("");
    } catch (e) {
      toast(errorText(e), "error");
    }
  }
  async function apply(id: string) {
    try {
      const r = await api.post<{ applied: number }>(`/api/templates/${id}/apply`, { targetDate: target });
      toast(`${r.applied} görev eklendi`, "success");
      onDone();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Program şablonları">
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <div className="mb-2 text-xs font-semibold">Kaydet</div>
          <div className="flex flex-wrap gap-2">
            <input className="input flex-1" placeholder="Şablon adı" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="input w-24" value={kind} onChange={(e) => setKind(e.target.value as "DAY" | "WEEK")}>
              <option value="DAY">Gün</option>
              <option value="WEEK">Hafta</option>
            </select>
            <input className="input w-36" type="date" value={source} onChange={(e) => setSource(e.target.value)} />
            <button className="btn-secondary" onClick={save} disabled={!name.trim()}>
              Kaydet
            </button>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold">Uygula</span>
            <input className="input w-36" type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
          {templates.length === 0 ? (
            <p className="text-xs text-slate-500">Kayıtlı şablon yok.</p>
          ) : (
            <ul className="space-y-1">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                  <span>
                    {t.name} <span className="text-xs text-slate-400">({t.kind === "DAY" ? "gün" : "hafta"})</span>
                  </span>
                  <button className="btn-primary px-3 py-1 text-xs" onClick={() => apply(t.id)}>
                    Uygula
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
