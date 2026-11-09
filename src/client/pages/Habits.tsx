import { useEffect, useState, type FormEvent } from "react";
import { Plus, Archive, Flame } from "lucide-react";
import { api } from "../lib/api";
import { useStore, errorText } from "../lib/store";
import { Modal, PageHeader, Empty, Spinner } from "../components/ui";
import { addDays, todayLocal, weekday, WEEKDAY_SHORT_TR } from "@shared/time";

interface Habit {
  id: string;
  name: string;
  icon: string;
  categoryId: string | null;
  frequency: "DAILY" | "WEEKLY";
  weekdays: number[];
  dailyTarget: number;
  weeklyTarget: number;
  active: boolean;
  streak: number;
  bestStreak: number;
  weekDone: number;
  totalDone: number;
  logs: { date: string; status: "DONE" | "SKIPPED" | "POSTPONED" }[];
}

export function HabitsPage() {
  const { toast, categories } = useStore();
  const today = todayLocal();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);

  const load = async () => {
    try {
      const r = await api.get<{ habits: Habit[] }>(`/api/habits?from=${days[0]}&to=${today}`);
      setHabits(r.habits);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cycle(h: Habit, date: string) {
    const cur = h.logs.find((l) => l.date === date)?.status;
    const next = cur === undefined ? "DONE" : cur === "DONE" ? "SKIPPED" : cur === "SKIPPED" ? "POSTPONED" : null;
    try {
      if (next === null) await api.delete(`/api/habits/${h.id}/log/${date}`);
      else await api.post(`/api/habits/${h.id}/log`, { date, status: next });
      await load();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  async function archive(h: Habit) {
    try {
      await api.delete(`/api/habits/${h.id}`);
      toast("Alışkanlık arşivlendi; geçmişi korunur", "success");
      await load();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Alışkanlıklar"
        subtitle="Günlük ve haftalık rutinlerini takip et. Bir gün kaçırmak geçmişini silmez."
        actions={
          <button className="btn-primary" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus size={16} /> Alışkanlık
          </button>
        }
      />
      {loading ? (
        <Spinner />
      ) : habits.length === 0 ? (
        <Empty text="Henüz alışkanlık yok. Örneğin: “Su iç”, “10 dk yoga”, “İngilizce kelime”." action={<button className="btn-primary" onClick={() => setOpen(true)}>İlk alışkanlığı ekle</button>} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-800">
                <th className="px-4 py-2.5 font-medium">Alışkanlık</th>
                {days.map((d) => (
                  <th key={d} className={`px-0.5 py-2 text-center font-medium ${d === today ? "text-brand-600" : ""}`}>
                    <div>{WEEKDAY_SHORT_TR[weekday(d)].slice(0, 2)}</div>
                    <div className="text-[10px] font-normal">{d.slice(8)}</div>
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-medium">Seri</th>
                <th className="px-3 py-2 text-center font-medium">Hafta</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {habits.map((h) => (
                <tr key={h.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="px-4 py-2.5">
                    <button className="font-medium hover:underline" onClick={() => { setEditing(h); setOpen(true); }}>
                      {h.name}
                    </button>
                    <div className="text-[11px] text-slate-500">{h.frequency === "DAILY" ? (h.weekdays.length === 7 ? "Her gün" : h.weekdays.map((d) => WEEKDAY_SHORT_TR[d]).join(", ")) : `Haftada ${h.weeklyTarget}×`}</div>
                  </td>
                  {days.map((d) => {
                    const st = h.logs.find((l) => l.date === d)?.status;
                    const expected = h.frequency !== "DAILY" || h.weekdays.includes(weekday(d));
                    return (
                      <td key={d} className="px-0.5 py-2 text-center">
                        <button
                          onClick={() => cycle(h, d)}
                          title={st === "DONE" ? "Tamamlandı" : st === "SKIPPED" ? "Atlandı" : st === "POSTPONED" ? "Ertelendi" : "İşaretle"}
                          className={`mx-auto flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-semibold transition-colors ${
                            st === "DONE"
                              ? "bg-emerald-500 text-white"
                              : st === "SKIPPED"
                                ? "bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-100"
                                : st === "POSTPONED"
                                  ? "bg-amber-300 text-amber-900"
                                  : expected
                                    ? "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
                                    : "bg-transparent"
                          }`}
                        >
                          {st === "DONE" ? "✓" : st === "SKIPPED" ? "–" : st === "POSTPONED" ? "→" : ""}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex items-center gap-1 text-sm">
                      <Flame size={14} className={h.streak > 0 ? "text-orange-500" : "text-slate-300"} /> {h.streak}
                    </span>
                    <div className="text-[10px] text-slate-400">en iyi {h.bestStreak}</div>
                  </td>
                  <td className="px-3 py-2 text-center text-sm">
                    {h.weekDone}/{h.frequency === "DAILY" ? h.weekdays.length : h.weeklyTarget}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <button className="btn-ghost p-1.5" title="Arşivle" onClick={() => archive(h)}>
                      <Archive size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-slate-500">Kutuya tıkla: tamamlandı → atlandı → ertelendi → boş</p>
        </div>
      )}
      <HabitForm open={open} onClose={() => setOpen(false)} onSaved={load} habit={editing} categories={categories} />
    </div>
  );
}

function HabitForm({ open, onClose, onSaved, habit, categories }: { open: boolean; onClose: () => void; onSaved: () => void; habit: Habit | null; categories: { id: string; name: string }[] }) {
  const { toast } = useStore();
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<"DAILY" | "WEEKLY">("DAILY");
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [weeklyTarget, setWeeklyTarget] = useState(3);
  const [categoryId, setCategoryId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(habit?.name ?? "");
    setFrequency(habit?.frequency ?? "DAILY");
    setWeekdays(habit?.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
    setWeeklyTarget(habit?.weeklyTarget ?? 3);
    setCategoryId(habit?.categoryId ?? "");
  }, [open, habit]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name, frequency, weekdays: frequency === "DAILY" ? weekdays : [0, 1, 2, 3, 4, 5, 6], weeklyTarget, categoryId: categoryId || null };
      if (habit) await api.patch(`/api/habits/${habit.id}`, body);
      else await api.post("/api/habits", body);
      onSaved();
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={habit ? "Alışkanlığı düzenle" : "Yeni alışkanlık"}>
      <form onSubmit={submit} className="space-y-3">
        <input className="input" placeholder="Örn. 10 dk yoga" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Sıklık</label>
            <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as "DAILY" | "WEEKLY")}>
              <option value="DAILY">Belirli günler</option>
              <option value="WEEKLY">Haftada N kez</option>
            </select>
          </div>
          <div>
            <label className="label">Kategori</label>
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Seçin</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {frequency === "DAILY" ? (
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button type="button" key={d} onClick={() => setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d])} className={`h-8 w-8 rounded-lg text-xs font-medium ${weekdays.includes(d) ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                {WEEKDAY_SHORT_TR[d]}
              </button>
            ))}
          </div>
        ) : (
          <div>
            <label className="label">Haftalık hedef</label>
            <input className="input" type="number" min={1} max={7} value={weeklyTarget} onChange={(e) => setWeeklyTarget(Number(e.target.value))} />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button className="btn-primary" disabled={busy}>
            Kaydet
          </button>
        </div>
      </form>
    </Modal>
  );
}
