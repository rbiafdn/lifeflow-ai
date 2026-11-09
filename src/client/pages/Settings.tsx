import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, Download, Upload, Undo2, Redo2, Save } from "lucide-react";
import { api } from "../lib/api";
import { useStore, errorText } from "../lib/store";
import { PageHeader, Confirm, Segmented } from "../components/ui";
import type { SettingsDTO, CategoryDTO } from "@shared/types";
import { WEEKDAY_SHORT_TR } from "@shared/time";

const DAYS = [1, 2, 3, 4, 5, 6, 0];

function DayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex gap-1">
      {DAYS.map((d) => (
        <button type="button" key={d} onClick={() => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort())} className={`h-8 w-9 rounded-lg text-xs font-medium ${value.includes(d) ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
          {WEEKDAY_SHORT_TR[d]}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { user, setUser, settings, refreshSettings, categories, refreshCategories, toast, theme, setTheme } = useStore();
  const [s, setS] = useState<SettingsDTO | null>(settings);
  const [name, setName] = useState(user?.name ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState({ name: "", color: "#6366f1", weeklyTargetMinutes: 0 });
  const [delCat, setDelCat] = useState<CategoryDTO | null>(null);
  const [delAccount, setDelAccount] = useState(false);
  const [history, setHistory] = useState<{ id: string; description: string; source: string; undone: boolean; createdAt: string }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; kind: string; createdAt: string }[]>([]);

  useEffect(() => setS(settings), [settings]);
  const loadExtras = async () => {
    try {
      const [h, t] = await Promise.all([api.get<{ history: typeof history }>("/api/operations/history"), api.get<{ templates: typeof templates }>("/api/templates")]);
      setHistory(h.history);
      setTemplates(t.templates);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  useEffect(() => {
    loadExtras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!s) return <div className="py-10 text-center text-sm text-slate-500">Yükleniyor…</div>;
  const set = <K extends keyof SettingsDTO>(k: K, v: SettingsDTO[K]) => setS({ ...s, [k]: v });

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    try {
      const { workDays, sportDays, restDays, weeklyGoals, notifications, ...rest } = s;
      await api.put("/api/settings", { ...rest, workDays, sportDays, restDays, weeklyGoals: weeklyGoals ?? {}, notifications });
      await refreshSettings();
      toast("Ayarlar kaydedildi", "success");
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api.patch<{ user: { id: string; name: string; email: string } }>("/api/auth/me", { name, ...(password ? { password } : {}) });
      setUser(r.user);
      setPassword("");
      toast("Profil güncellendi", "success");
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function addCategory(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post("/api/categories", newCat);
      setNewCat({ name: "", color: "#6366f1", weeklyTargetMinutes: 0 });
      await refreshCategories();
    } catch (err) {
      toast(errorText(err), "error");
    }
  }
  async function updateCategory(c: CategoryDTO, patch: Partial<CategoryDTO>) {
    try {
      await api.patch(`/api/categories/${c.id}`, patch);
      await refreshCategories();
    } catch (err) {
      toast(errorText(err), "error");
    }
  }
  async function removeCategory() {
    if (!delCat) return;
    try {
      await api.delete(`/api/categories/${delCat.id}`);
      setDelCat(null);
      await refreshCategories();
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function download(url: string) {
    const res = await fetch(url, { credentials: "include" });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? "lifeflow-export";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importFile(file: File) {
    try {
      const json = JSON.parse(await file.text());
      const r = await api.post<{ imported: { tasks: number; habits: number } }>("/api/data/import", json);
      toast(`İçe aktarıldı: ${r.imported.tasks} görev, ${r.imported.habits} alışkanlık`, "success");
      await refreshCategories();
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function undoRedo(kind: "undo" | "redo") {
    try {
      const r = await api.post<{ description: string }>(`/api/operations/${kind}`);
      toast(`${kind === "undo" ? "Geri alındı" : "Yeniden uygulandı"}: ${r.description}`, "success");
      await loadExtras();
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  async function deleteAccount() {
    try {
      await api.delete("/api/data/account", { confirm: "SİL" });
      setUser(null);
      window.location.href = "/giris";
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Ayarlar" subtitle="Bu bilgiler AI planlama ve otomatik yeniden planlamada kullanılır." />

      <form onSubmit={saveSettings} className="card space-y-4 p-4">
        <h2 className="text-sm font-semibold">Günlük düzen</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Uyanma">
            <input className="input" type="time" value={s.wakeTime} onChange={(e) => set("wakeTime", e.target.value)} />
          </Field>
          <Field label="Uyku">
            <input className="input" type="time" value={s.sleepTime} onChange={(e) => set("sleepTime", e.target.value)} />
          </Field>
          <Field label="İş başlangıcı">
            <input className="input" type="time" value={s.workStart} onChange={(e) => set("workStart", e.target.value)} />
          </Field>
          <Field label="İş bitişi">
            <input className="input" type="time" value={s.workEnd} onChange={(e) => set("workEnd", e.target.value)} />
          </Field>
          <Field label="Yol süresi (dk)">
            <input className="input" type="number" min={0} value={s.commuteMinutes} onChange={(e) => set("commuteMinutes", Number(e.target.value))} />
          </Field>
          <Field label="Günlük boş zaman (dk)">
            <input className="input" type="number" min={0} value={s.dailyFreeMinutes} onChange={(e) => set("dailyFreeMinutes", Number(e.target.value))} />
          </Field>
          <Field label="Odak saati başlangıç">
            <input className="input" type="time" value={s.focusStart} onChange={(e) => set("focusStart", e.target.value)} />
          </Field>
          <Field label="Odak saati bitiş">
            <input className="input" type="time" value={s.focusEnd} onChange={(e) => set("focusEnd", e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="İş günleri">
            <DayPicker value={s.workDays} onChange={(v) => set("workDays", v)} />
          </Field>
          <Field label="Spor günleri">
            <DayPicker value={s.sportDays} onChange={(v) => set("sportDays", v)} />
          </Field>
          <Field label="Dinlenme günleri">
            <DayPicker value={s.restDays} onChange={(v) => set("restDays", v)} />
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Zaman dilimi">
            <input className="input" value={s.timezone} onChange={(e) => set("timezone", e.target.value)} />
          </Field>
          <Field label="Bildirimler">
            <div className="flex flex-wrap gap-3 pt-2 text-sm">
              {(["dailySummary", "email", "push"] as const).map((k) => (
                <label key={k} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={s.notifications?.[k] ?? false} onChange={(e) => set("notifications", { ...s.notifications, [k]: e.target.checked })} />
                  {k === "dailySummary" ? "Günlük özet" : k === "email" ? "E-posta" : "Anlık"}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Tema">
            <Segmented value={theme} onChange={setTheme} options={[{ value: "system", label: "Sistem" }, { value: "light", label: "Açık" }, { value: "dark", label: "Koyu" }]} />
          </Field>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" disabled={busy}>
            <Save size={15} /> Kaydet
          </button>
        </div>
      </form>

      <div className="card p-4">
        <h2 className="mb-1 text-sm font-semibold">Kategoriler ve haftalık hedefler</h2>
        <p className="mb-3 text-xs text-slate-500">Haftalık hedef dakikası, ana ekrandaki ilerleme çubuklarında ve “günü planla”da kullanılır.</p>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
              <input type="color" value={c.color} onChange={(e) => updateCategory(c, { color: e.target.value })} className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent" />
              <input className="input flex-1" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && updateCategory(c, { name: e.target.value })} />
              <input className="input w-24" type="number" min={0} step={15} defaultValue={c.weeklyTargetMinutes} title="Haftalık hedef (dk)" onBlur={(e) => Number(e.target.value) !== c.weeklyTargetMinutes && updateCategory(c, { weeklyTargetMinutes: Number(e.target.value) })} />
              <span className="w-8 text-[11px] text-slate-400">dk/hf</span>
              <button className="btn-ghost p-1.5 text-red-600" onClick={() => setDelCat(c)}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addCategory} className="mt-3 flex items-center gap-2">
          <input type="color" value={newCat.color} onChange={(e) => setNewCat({ ...newCat, color: e.target.value })} className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent" />
          <input className="input flex-1" placeholder="Yeni kategori" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} required />
          <input className="input w-24" type="number" min={0} step={15} placeholder="dk/hf" value={newCat.weeklyTargetMinutes || ""} onChange={(e) => setNewCat({ ...newCat, weeklyTargetMinutes: Number(e.target.value) })} />
          <button className="btn-secondary">
            <Plus size={15} />
          </button>
        </form>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <form onSubmit={saveProfile} className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold">Profil</h2>
          <Field label="Ad">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="E-posta">
            <input className="input" value={user?.email ?? ""} disabled />
          </Field>
          <Field label="Yeni şifre (boş bırakılabilir)">
            <input className="input" type="password" value={password} minLength={8} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <div className="flex justify-end">
            <button className="btn-secondary">Güncelle</button>
          </div>
        </form>

        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold">Veri ve yedekleme</h2>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => download("/api/data/export.json")}>
              <Download size={15} /> JSON yedek
            </button>
            <button className="btn-secondary" onClick={() => download("/api/data/export.csv")}>
              <Download size={15} /> CSV (görevler)
            </button>
            <label className="btn-secondary cursor-pointer">
              <Upload size={15} /> JSON içe aktar
              <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            </label>
          </div>
          <p className="text-xs text-slate-500">AI istekleri saklanmaz; yalnızca günlük çağrı sayısı tutulur.</p>
          <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
            <button className="btn-ghost text-red-600" onClick={() => setDelAccount(true)}>
              <Trash2 size={15} /> Hesabımı ve tüm verilerimi sil
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Değişiklik geçmişi</h2>
            <div className="flex gap-1">
              <button className="btn-ghost p-1.5" onClick={() => undoRedo("undo")} title="Geri al">
                <Undo2 size={15} />
              </button>
              <button className="btn-ghost p-1.5" onClick={() => undoRedo("redo")} title="Yeniden uygula">
                <Redo2 size={15} />
              </button>
            </div>
          </div>
          {history.length === 0 ? (
            <p className="text-xs text-slate-500">Henüz değişiklik yok.</p>
          ) : (
            <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
              {history.map((h) => (
                <li key={h.id} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${h.undone ? "text-slate-400 line-through" : ""}`}>
                  <span className="truncate">
                    {h.source === "AI" && <span className="mr-1 rounded bg-brand-100 px-1 text-[10px] text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">AI</span>}
                    {h.description}
                  </span>
                  <span className="shrink-0 text-slate-400">{new Date(h.createdAt).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Program şablonları</h2>
          {templates.length === 0 ? (
            <p className="text-xs text-slate-500">Takvim sayfasından bir günü veya haftayı şablon olarak kaydedebilirsin.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center justify-between">
                  <span>
                    {t.name} <span className="text-xs text-slate-400">({t.kind === "DAY" ? "gün" : "hafta"})</span>
                  </span>
                  <button
                    className="btn-ghost p-1.5 text-red-600"
                    onClick={async () => {
                      await api.delete(`/api/templates/${t.id}`);
                      loadExtras();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Confirm open={!!delCat} onClose={() => setDelCat(null)} onConfirm={removeCategory} title="Kategoriyi sil" text={`"${delCat?.name}" silinecek; bu kategorideki görevler kategorisiz kalır.`} danger />
      <Confirm open={delAccount} onClose={() => setDelAccount(false)} onConfirm={deleteAccount} title="Hesabı sil" text="Tüm görevler, alışkanlıklar, hedefler ve ayarlar kalıcı olarak silinecek. Önce JSON yedek almanı öneririz." danger />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
