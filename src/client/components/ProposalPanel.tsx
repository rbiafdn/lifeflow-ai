import { useState } from "react";
import { AlertTriangle, Plus, Pencil, Trash2, ArrowRight } from "lucide-react";
import type { PreviewLine } from "@shared/types";

export interface ProposalView {
  summary?: string;
  rationale?: string;
  explanation?: string[];
  preview: PreviewLine[];
  warnings: string[];
}

/** Eski plan → yeni plan önizlemesi ve onay/ret düğmeleri. */
export function ProposalPanel({ p, onApply, onReject, busy, applyLabel = "Onayla ve uygula" }: { p: ProposalView; onApply: () => void; onReject: () => void; busy?: boolean; applyLabel?: string }) {
  const [showAll, setShowAll] = useState(false);
  const lines = showAll ? p.preview : p.preview.slice(0, 8);
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/50">
        <div className="text-sm font-semibold">{p.summary ?? "Önerilen değişiklikler"}</div>
        {p.rationale && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{p.rationale}</p>}
      </div>
      {p.explanation && p.explanation.length > 0 && (
        <ul className="space-y-1 border-b border-slate-200 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
          {p.explanation.map((e, i) => (
            <li key={i}>• {e}</li>
          ))}
        </ul>
      )}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${l.kind === "create" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200" : l.kind === "delete" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200" : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200"}`}>
              {l.kind === "create" ? <Plus size={14} /> : l.kind === "delete" ? <Trash2 size={14} /> : <Pencil size={14} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{l.title}</div>
              <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                {l.before && <span className={l.after ? "line-through" : ""}>{l.before}</span>}
                {l.before && l.after && <ArrowRight size={12} />}
                {l.after && <span className="text-slate-700 dark:text-slate-200">{l.after}</span>}
              </div>
              {l.reason && <div className="mt-0.5 text-[11px] text-slate-400">{l.reason}</div>}
              {l.warning && (
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-600">
                  <AlertTriangle size={12} /> {l.warning}
                </div>
              )}
            </div>
          </li>
        ))}
        {p.preview.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">Değişiklik yok.</li>}
      </ul>
      {p.preview.length > 8 && (
        <button className="w-full py-2 text-xs font-medium text-brand-600 hover:underline" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Daha az göster" : `${p.preview.length - 8} değişiklik daha`}
        </button>
      )}
      {p.warnings.length > 0 && (
        <div className="space-y-1 border-t border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {p.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        <button className="btn-secondary" onClick={onReject} disabled={busy}>
          Reddet
        </button>
        <button className="btn-primary" onClick={onApply} disabled={busy || p.preview.length === 0}>
          {busy ? "Uygulanıyor…" : applyLabel}
        </button>
      </div>
    </div>
  );
}
