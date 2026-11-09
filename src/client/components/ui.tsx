import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Priority, TimeType, TaskStatus } from "@shared/types";
import { PRIORITY_LABELS, TIME_TYPE_LABELS, STATUS_LABELS } from "@shared/types";

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm md:items-center md:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`card max-h-[92vh] w-full overflow-y-auto rounded-b-none p-5 md:rounded-2xl ${wide ? "md:max-w-2xl" : "md:max-w-md"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn-ghost p-1.5" onClick={onClose} aria-label="Kapat">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700">
      <span>{text}</span>
      {action}
    </div>
  );
}

export function Spinner({ text = "Yükleniyor…" }: { text?: string }) {
  return <div className="py-10 text-center text-sm text-slate-500">{text}</div>;
}

export const PRIORITY_COLORS: Record<Priority, string> = {
  LOW: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  MEDIUM: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
  HIGH: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  CRITICAL: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
};

export const TIME_TYPE_COLORS: Record<TimeType, string> = {
  FIXED: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  FLEXIBLE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
  PRIORITY: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
  OPTIONAL: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  REST: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200",
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  PLANNED: "",
  DONE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
  SKIPPED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  CANCELLED: "bg-slate-100 text-slate-500 line-through dark:bg-slate-800 dark:text-slate-400",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
  POSTPONED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
};

export function PriorityChip({ p }: { p: Priority }) {
  return <span className={`chip ${PRIORITY_COLORS[p]}`}>{PRIORITY_LABELS[p]}</span>;
}
export function TimeTypeChip({ t }: { t: TimeType }) {
  return <span className={`chip ${TIME_TYPE_COLORS[t]}`}>{TIME_TYPE_LABELS[t]}</span>;
}
export function StatusChip({ s }: { s: TaskStatus }) {
  if (s === "PLANNED") return null;
  return <span className={`chip ${STATUS_COLORS[s]}`}>{STATUS_LABELS[s]}</span>;
}

export function Progress({ value, color = "bg-brand-500" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${value === o.value ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Confirm({ open, onClose, onConfirm, title, text, danger }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; text: string; danger?: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-slate-600 dark:text-slate-300">{text}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          Vazgeç
        </button>
        <button className={danger ? "btn-danger" : "btn-primary"} onClick={onConfirm}>
          Onayla
        </button>
      </div>
    </Modal>
  );
}
