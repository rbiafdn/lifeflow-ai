import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, Cell } from "recharts";
import { Sparkles, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { useStore, errorText } from "../lib/store";
import { PageHeader, Segmented, Spinner } from "../components/ui";
import { todayLocal, weekday, WEEKDAY_SHORT_TR, formatDateTR, addDays, weekStart } from "@shared/time";

interface Stats {
  from: string;
  to: string;
  totals: { planned: number; done: number; skipped: number; cancelled: number; failed: number; postponed: number; total: number };
  completionRate: number;
  postponeEvents: number;
  byDay: { date: string; done: number; total: number; rate: number; minutesDone: number }[];
  byCategory: { categoryId: string | null; name: string; color: string; minutesDone: number; minutesPlanned: number; weeklyTarget: number; done: number; total: number }[];
  habits: { habitId: string; name: string; done: number; expected: number; rate: number; streak: number }[];
  sleep: { avgMinutes: number | null; nights: number; plannedMinutes: number };
}

interface Review {
  weekStart: string;
  weekEnd: string;
  content: string;
  cached: boolean;
}

// Doğrulanmış kategorik palet (dataviz referansı): slot 1 mavi, slot 2 turuncu
const SERIES = {
  light: { done: "#2a78d6", open: "#eb6834", sleep: "#2a78d6", target: "#52514e" },
  dark: { done: "#3987e5", open: "#d95926", sleep: "#3987e5", target: "#c3c2b7" },
};

export function StatsPage() {
  const { toast, theme } = useStore();
  const today = todayLocal();
  const [range, setRange] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(today);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sleep, setSleep] = useState<{ date: string; minutes: number }[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const C = dark ? SERIES.dark : SERIES.light;

  useEffect(() => {
    (async () => {
      try {
        const [s, sl, st] = await Promise.all([
          api.get<Stats>(`/api/stats?range=${range}&date=${anchor}`),
          api.get<{ logs: { date: string; minutes: number }[] }>(`/api/sleep?from=${addDays(today, -13)}&to=${today}`),
          api.get<{ enabled: boolean }>("/api/ai/status"),
        ]);
        setStats(s);
        setSleep(sl.logs);
        setAiEnabled(st.enabled);
        if (range === "week") {
          const r = await api.get<Review | null>(`/api/ai/weekly-review?date=${anchor}`);
          setReview(r);
        } else setReview(null);
      } catch (e) {
        toast(errorText(e), "error");
      }
    })();
  }, [range, anchor, today, toast]);

  async function generateReview(force: boolean) {
    setReviewBusy(true);
    try {
      const r = await api.post<Review>("/api/ai/weekly-review", { date: anchor, force });
      setReview(r);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setReviewBusy(false);
    }
  }

  function shift(dir: -1 | 1) {
    if (range === "week") setAnchor(addDays(anchor, 7 * dir));
    else {
      const d = new Date(anchor.slice(0, 7) + "-01T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + dir);
      setAnchor(d.toISOString().slice(0, 10));
    }
  }

  if (!stats) return <Spinner />;
  const dayData = stats.byDay.map((d) => ({ name: range === "week" ? WEEKDAY_SHORT_TR[weekday(d.date)] : d.date.slice(8), done: d.done, open: Math.max(0, d.total - d.done), date: d.date }));
  const catData = stats.byCategory.filter((c) => c.minutesDone > 0 || c.weeklyTarget > 0).slice(0, 10);
  const scorable = stats.totals.total - stats.totals.cancelled;
  const tickStyle = { fontSize: 11, fill: dark ? "#c3c2b7" : "#52514e" };
  const tooltipStyle = { background: dark ? "#1a1a19" : "#fcfcfb", border: `1px solid ${dark ? "#333" : "#e5e5e3"}`, borderRadius: 10, fontSize: 12, color: dark ? "#f0efec" : "#0b0b0b" };

  return (
    <div className="space-y-5">
      <PageHeader
        title="İstatistik"
        subtitle={`${formatDateTR(stats.from, false)} – ${formatDateTR(stats.to, false)}`}
        actions={
          <>
            <Segmented value={range} onChange={(v) => { setRange(v); setAnchor(today); }} options={[{ value: "week", label: "Hafta" }, { value: "month", label: "Ay" }]} />
            <button className="btn-secondary px-2.5" onClick={() => shift(-1)}>
              ‹
            </button>
            <button className="btn-secondary px-2.5" onClick={() => shift(1)}>
              ›
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Tamamlama" value={`%${stats.completionRate}`} hint={`${stats.totals.done}/${scorable} görev`} />
        <Tile label="Ertelenen" value={String(stats.postponeEvents)} hint="erteleme olayı" />
        <Tile label="Atlanan / yapılamayan" value={String(stats.totals.skipped + stats.totals.failed)} hint={`${stats.totals.cancelled} iptal`} />
        <Tile label="Uyku" value={stats.sleep.avgMinutes ? `${(stats.sleep.avgMinutes / 60).toFixed(1)} sa` : `${(stats.sleep.plannedMinutes / 60).toFixed(1)} sa`} hint={stats.sleep.avgMinutes ? `${stats.sleep.nights} gece kayıt` : "planlanan (kayıt yok)"} />
      </div>

      {range === "week" && (
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles size={15} className="text-brand-600" /> Haftalık AI değerlendirmesi
            </h2>
            <div className="flex gap-1">
              {review && (
                <button className="btn-ghost p-1.5" title="Yeniden üret" onClick={() => generateReview(true)} disabled={reviewBusy || !aiEnabled}>
                  <RefreshCw size={14} className={reviewBusy ? "animate-spin" : ""} />
                </button>
              )}
              {!review && (
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => generateReview(false)} disabled={reviewBusy || !aiEnabled}>
                  {reviewBusy ? "Hazırlanıyor…" : "Değerlendir"}
                </button>
              )}
            </div>
          </div>
          {!aiEnabled && <p className="text-xs text-amber-600">Claude API anahtarı tanımlı olmadığı için değerlendirme üretilemiyor.</p>}
          {review ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-slate-200">{review.content}</p> : aiEnabled && <p className="text-xs text-slate-500">Gerçek verilere dayanan kısa bir haftalık değerlendirme ve gelecek hafta için öneriler.</p>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-1 text-sm font-semibold">Günlük görevler</h2>
          <div className="mb-2 flex gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: C.done }} /> Tamamlanan
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: C.open }} /> Tamamlanmayan
            </span>
          </div>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={dayData} barCategoryGap={range === "week" ? "30%" : "15%"}>
                <CartesianGrid vertical={false} stroke={dark ? "#2a2a29" : "#eeeeec"} />
                <XAxis dataKey="name" tick={tickStyle} axisLine={false} tickLine={false} interval={range === "week" ? 0 : 4} />
                <YAxis tick={tickStyle} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: dark ? "#ffffff0d" : "#0000000a" }} labelFormatter={(_, p) => (p?.[0]?.payload?.date ? formatDateTR(p[0].payload.date) : "")} formatter={(v, n) => [v, n === "done" ? "Tamamlanan" : "Tamamlanmayan"]} />
                <Bar dataKey="done" stackId="a" fill={C.done} stroke={dark ? "#1a1a19" : "#fcfcfb"} strokeWidth={2} />
                <Bar dataKey="open" stackId="a" fill={C.open} stroke={dark ? "#1a1a19" : "#fcfcfb"} strokeWidth={2} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="mb-1 text-sm font-semibold">Kategori süreleri (dk, tamamlanan)</h2>
          <p className="mb-2 text-[11px] text-slate-500">Renkler kategori renkleridir; hedefi olanlarda haftalık hedef işaretlenir.</p>
          {catData.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Bu aralıkta tamamlanan görev yok.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={catData} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid horizontal={false} stroke={dark ? "#2a2a29" : "#eeeeec"} />
                  <XAxis type="number" tick={tickStyle} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={tickStyle} axisLine={false} tickLine={false} width={90} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: dark ? "#ffffff0d" : "#0000000a" }} formatter={(v, _n, item) => [`${v} dk${item.payload.weeklyTarget ? ` / hedef ${item.payload.weeklyTarget}` : ""}`, "Tamamlanan"]} />
                  <Bar dataKey="minutesDone" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, fill: tickStyle.fill }}>
                    {catData.map((c) => (
                      <Cell key={c.categoryId ?? "none"} fill={c.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Alışkanlıklar</h2>
          {stats.habits.length === 0 ? (
            <p className="text-sm text-slate-500">Aktif alışkanlık yok.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-1 text-left font-medium">Alışkanlık</th>
                  <th className="pb-1 text-right font-medium">Yapılan</th>
                  <th className="pb-1 text-right font-medium">Oran</th>
                  <th className="pb-1 text-right font-medium">Seri</th>
                </tr>
              </thead>
              <tbody>
                {stats.habits.map((h) => (
                  <tr key={h.habitId} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5">{h.name}</td>
                    <td className="py-1.5 text-right">
                      {h.done}/{h.expected}
                    </td>
                    <td className="py-1.5 text-right">%{h.rate}</td>
                    <td className="py-1.5 text-right">🔥 {h.streak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card p-4">
          <h2 className="mb-1 text-sm font-semibold">Uyku (son 14 gün)</h2>
          {sleep.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Uyku kaydı yok. Ana ekrandan veya aşağıdan ekleyebilirsin.</p>
          ) : (
            <div className="h-40">
              <ResponsiveContainer>
                <LineChart data={sleep.map((s) => ({ name: s.date.slice(5), hours: Math.round((s.minutes / 60) * 10) / 10 }))}>
                  <CartesianGrid vertical={false} stroke={dark ? "#2a2a29" : "#eeeeec"} />
                  <XAxis dataKey="name" tick={tickStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={tickStyle} axisLine={false} tickLine={false} width={28} domain={[0, 12]} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v} sa`, "Uyku"]} />
                  <Line type="monotone" dataKey="hours" stroke={C.sleep} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: dark ? "#1a1a19" : "#fcfcfb", fill: C.sleep }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <SleepForm onSaved={async () => setSleep((await api.get<{ logs: typeof sleep }>(`/api/sleep?from=${addDays(today, -13)}&to=${today}`)).logs)} />
        </div>
      </div>
      <p className="text-[11px] text-slate-400">Tüm sayılar kayıtlı görev, alışkanlık ve uyku verilerinden hesaplanır; haftalar Pazartesi ({formatDateTR(weekStart(anchor), false)}) başlar.</p>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">{hint}</div>
    </div>
  );
}

function SleepForm({ onSaved }: { onSaved: () => void }) {
  const { toast } = useStore();
  const [date, setDate] = useState(addDays(todayLocal(), -1));
  const [bed, setBed] = useState("23:30");
  const [wake, setWake] = useState("07:00");
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.post("/api/sleep", { date, bedTime: bed, wakeTime: wake });
          toast("Uyku kaydedildi", "success");
          onSaved();
        } catch (err) {
          toast(errorText(err), "error");
        }
      }}
    >
      <div>
        <label className="label">Gece</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div>
        <label className="label">Yatış</label>
        <input className="input" type="time" value={bed} onChange={(e) => setBed(e.target.value)} />
      </div>
      <div>
        <label className="label">Kalkış</label>
        <input className="input" type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
      </div>
      <button className="btn-secondary">Kaydet</button>
    </form>
  );
}
