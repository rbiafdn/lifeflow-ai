import { Check, Clock, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import type { TaskDTO } from "@shared/types";
import { useStore } from "../lib/store";
import { PriorityChip, StatusChip, TimeTypeChip } from "./ui";
import { formatDuration } from "@shared/time";

export interface TaskActions {
  onToggleDone: (t: TaskDTO) => void;
  onEdit: (t: TaskDTO) => void;
  onPostpone: (t: TaskDTO, minutes: number) => void;
  onMoveTomorrow: (t: TaskDTO) => void;
  onFailed: (t: TaskDTO) => void;
  onCancel: (t: TaskDTO) => void;
}

export function TaskItem({ t, actions, compact, conflict }: { t: TaskDTO; actions: TaskActions; compact?: boolean; conflict?: boolean }) {
  const { categoryById } = useStore();
  const cat = categoryById(t.categoryId);
  const [menu, setMenu] = useState(false);
  const done = t.status === "DONE";
  const inactive = t.status === "CANCELLED" || t.status === "SKIPPED";

  return (
    <div className={`group relative flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${conflict ? "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30" : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"} ${inactive ? "opacity-60" : ""}`}>
      <button
        onClick={() => actions.onToggleDone(t)}
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 hover:border-brand-500 dark:border-slate-600"}`}
        aria-label={done ? "Tamamlandı" : "Tamamla"}
      >
        {done && <Check size={14} />}
      </button>
      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => actions.onEdit(t)}>
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 ${done ? "line-through text-slate-400" : ""}`}>
          <span className="text-sm font-medium">{t.title}</span>
          {cat && (
            <span className="chip" style={{ background: cat.color + "22", color: cat.color }}>
              {cat.name}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Clock size={12} />
            {t.startTime ? `${t.startTime}–${t.endTime}` : "Saatsiz"} · {formatDuration(t.durationMinutes)}
          </span>
          {!compact && (
            <>
              <TimeTypeChip t={t.timeType} />
              {t.priority !== "MEDIUM" && <PriorityChip p={t.priority} />}
            </>
          )}
          <StatusChip s={t.status} />
          {t.postponeCount > 0 && <span className="text-[11px] text-amber-600">{t.postponeCount}× ertelendi</span>}
          {conflict && <span className="text-[11px] font-medium text-red-600">Çakışma</span>}
        </div>
      </div>
      <div className="relative">
        <button className="btn-ghost p-1.5" onClick={() => setMenu(!menu)} aria-label="İşlemler">
          <MoreHorizontal size={16} />
        </button>
        {menu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
            <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {[
                { label: "Düzenle", fn: () => actions.onEdit(t) },
                { label: "30 dk ertele", fn: () => actions.onPostpone(t, 30) },
                { label: "1 saat ertele", fn: () => actions.onPostpone(t, 60) },
                { label: "Yarına taşı", fn: () => actions.onMoveTomorrow(t) },
                { label: "Yapamadım", fn: () => actions.onFailed(t) },
                { label: "İptal et", fn: () => actions.onCancel(t) },
              ].map((m) => (
                <button
                  key={m.label}
                  className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                  onClick={() => {
                    setMenu(false);
                    m.fn();
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
