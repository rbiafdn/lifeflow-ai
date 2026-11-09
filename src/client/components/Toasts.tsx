import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { useStore } from "../lib/store";

export function Toasts() {
  const { toasts } = useStore();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg ${
            t.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
              : t.kind === "error"
                ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
                : "border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          }`}
        >
          {t.kind === "success" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : t.kind === "error" ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <Info size={16} className="mt-0.5 shrink-0" />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
