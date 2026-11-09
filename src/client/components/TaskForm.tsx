import { useEffect, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useStore, errorText } from "../lib/store";
import { Modal, Confirm } from "./ui";
import type { TaskDTO, Priority, TimeType, TaskStatus } from "@shared/types";
import { PRIORITIES, TIME_TYPES, PRIORITY_LABELS, TIME_TYPE_LABELS, FLEXIBILITY_LABELS, STATUS_LABELS } from "@shared/types";
import { WEEKDAY_SHORT_TR } from "@shared/time";

export interface TaskFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  task?: TaskDTO | null;
  defaults?: Partial<TaskDTO>;
}

interface FormState {
  title: string;
  notes: string;
  categoryId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  priority: Priority;
  timeType: TimeType;
  flexibility: number;
  deadline: string;
  difficulty: number;
  status: TaskStatus;
  repeat: "none" | "DAILY" | "WEEKLY";
  weekdays: number[];
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

export function TaskForm({ open, onClose, onSaved, task, defaults }: TaskFormProps) {
  const { categories, toast } = useStore();
  const [f, setF] = useState<FormState>(() => initial(task, defaults));
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (open) {
      setF(initial(task, defaults));
      setMore(false);
    }
  }, [open, task, defaults]);

  function initial(t?: TaskDTO | null, d?: Partial<TaskDTO>): FormState {
    const src = t ?? d ?? {};
    return {
      title: src.title ?? "",
      notes: src.notes ?? "",
      categoryId: src.categoryId ?? "",
      date: src.date ?? new Date().toISOString().slice(0, 10),
      startTime: src.startTime ?? "",
      durationMinutes: src.durationMinutes ?? 30,
      priority: (src.priority as Priority) ?? "MEDIUM",
      timeType: (src.timeType as TimeType) ?? "FLEXIBLE",
      flexibility: src.flexibility ?? 1,
      deadline: src.deadline ?? "",
      difficulty: src.difficulty ?? 2,
      status: (src.status as TaskStatus) ?? "PLANNED",
      repeat: "none",
      weekdays: [],
    };
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return;
    setBusy(true);
    try {
      const body = {
        title: f.title.trim(),
        notes: f.notes || null,
        categoryId: f.categoryId || null,
        date: f.date,
        startTime: f.startTime || null,
        durationMinutes: f.durationMinutes,
        priority: f.priority,
        timeType: f.timeType,
        flexibility: f.timeType === "FIXED" ? 0 : f.flexibility,
        deadline: f.deadline || null,
        difficulty: f.difficulty,
      };
      if (task) {
        await api.patch(`/api/tasks/${task.id}`, { ...body, status: f.status });
        toast("Görev güncellendi", "success");
      } else if (f.repeat !== "none") {
        if (f.repeat === "WEEKLY" && f.weekdays.length === 0) {
          toast("Haftalık tekrar için gün seçin", "error");
          setBusy(false);
          return;
        }
        await api.post("/api/recurrences", {
          title: body.title,
          notes: body.notes,
          categoryId: body.categoryId,
          startTime: body.startTime,
          durationMinutes: body.durationMinutes,
          priority: body.priority,
          timeType: body.timeType,
          flexibility: body.flexibility,
          difficulty: body.difficulty,
          frequency: f.repeat,
          weekdays: f.repeat === "WEEKLY" ? f.weekdays : [],
          startDate: f.date,
        });
        toast("Tekrarlayan görev oluşturuldu", "success");
      } else {
        await api.post("/api/tasks", body);
        toast("Görev eklendi", "success");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!task) return;
    try {
      await api.delete(`/api/tasks/${task.id}`);
      toast("Görev silindi (geri alınabilir)", "success");
      onSaved();
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? "Görevi düzenle" : "Yeni görev"}>
      <form onSubmit={submit} className="space-y-3">
        <input className="input text-base" placeholder="Ne yapacaksın?" value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus required />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Tarih</label>
            <input className="input" type="date" value={f.date} onChange={(e) => set("date", e.target.value)} required />
          </div>
          <div>
            <label className="label">Saat (isteğe bağlı)</label>
            <input className="input" type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Süre</label>
            <select className="input" value={f.durationMinutes} onChange={(e) => set("durationMinutes", Number(e.target.value))}>
              {[...new Set([...DURATIONS, f.durationMinutes])].sort((a, b) => a - b).map((d) => (
                <option key={d} value={d}>
                  {d >= 60 ? `${Math.floor(d / 60)} sa${d % 60 ? ` ${d % 60} dk` : ""}` : `${d} dk`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Kategori</label>
            <select className="input" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">Seçin</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Zaman türü</label>
            <select className="input" value={f.timeType} onChange={(e) => set("timeType", e.target.value as TimeType)}>
              {TIME_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TIME_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Öncelik</label>
            <select className="input" value={f.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!task && (
          <div>
            <label className="label">Tekrar</label>
            <div className="flex flex-wrap gap-1.5">
              {(["none", "DAILY", "WEEKLY"] as const).map((r) => (
                <button type="button" key={r} onClick={() => set("repeat", r)} className={`chip cursor-pointer border px-2.5 py-1 ${f.repeat === r ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200" : "border-slate-200 dark:border-slate-700"}`}>
                  {r === "none" ? "Tek sefer" : r === "DAILY" ? "Her gün" : "Haftalık"}
                </button>
              ))}
            </div>
            {f.repeat === "WEEKLY" && (
              <div className="mt-2 flex gap-1">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => set("weekdays", f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d])}
                    className={`h-8 w-8 rounded-lg text-xs font-medium ${f.weekdays.includes(d) ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}
                  >
                    {WEEKDAY_SHORT_TR[d]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setMore(!more)}>
          {more ? "Daha az" : "Daha fazla seçenek"}
        </button>

        {more && (
          <div className="space-y-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Esneklik</label>
                <select className="input" value={f.flexibility} disabled={f.timeType === "FIXED"} onChange={(e) => set("flexibility", Number(e.target.value))}>
                  {[0, 1, 2, 3].map((v) => (
                    <option key={v} value={v}>
                      {FLEXIBILITY_LABELS[v]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Zorluk (1-5)</label>
                <input className="input" type="number" min={1} max={5} value={f.difficulty} onChange={(e) => set("difficulty", Number(e.target.value))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Son tarih</label>
                <input className="input" type="date" value={f.deadline} onChange={(e) => set("deadline", e.target.value)} />
              </div>
              {task && (
                <div>
                  <label className="label">Durum</label>
                  <select className="input" value={f.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
                    {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div>
              <label className="label">Notlar</label>
              <textarea className="input" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
            </div>
            {task?.recurrenceId && <p className="text-[11px] text-slate-500">Bu, tekrarlayan bir serinin tek örneğidir; burada yapılan değişiklik yalnızca bu tarihi etkiler.</p>}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          {task ? (
            <button type="button" className="btn-ghost text-red-600" onClick={() => setConfirmDel(true)}>
              <Trash2 size={16} /> Sil
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Vazgeç
            </button>
            <button className="btn-primary" disabled={busy}>
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </button>
          </div>
        </div>
      </form>
      <Confirm open={confirmDel} onClose={() => setConfirmDel(false)} onConfirm={remove} title="Görevi sil" text="Görev silinecek. Geçmiş panelinden geri alabilirsin." danger />
    </Modal>
  );
}
