import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, Check, BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import { useStore, errorText } from "../lib/store";
import { Modal, PageHeader, Empty, Spinner, Progress, Confirm } from "../components/ui";
import { LEARNING_AREAS } from "@shared/defaults";

interface Milestone {
  id: string;
  title: string;
  done: boolean;
  sortOrder: number;
}
interface Goal {
  id: string;
  title: string;
  description: string | null;
  area: string;
  categoryId: string | null;
  targetDate: string | null;
  status: "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
  milestones: Milestone[];
  progress: number;
  minutesDone: number;
  tasksDone: number;
  _count: { notes: number; tasks: number };
}
interface Note {
  id: string;
  goalId: string | null;
  kind: "note" | "vocab" | "topic";
  title: string;
  content: string;
  tags: string[];
  mastered: boolean;
  updatedAt: string;
}

const AREA_LABEL = (key: string) => LEARNING_AREAS.find((a) => a.key === key)?.label ?? key;

export function GoalsPage() {
  const { toast } = useStore();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [area, setArea] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [del, setDel] = useState<Goal | null>(null);

  const load = async () => {
    try {
      const r = await api.get<{ goals: Goal[] }>("/api/goals");
      setGoals(r.goals);
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

  const areas = ["all", ...new Set([...LEARNING_AREAS.map((a) => a.key), ...goals.map((g) => g.area)])];
  const visible = goals.filter((g) => (area === "all" || g.area === area) && g.status !== "ARCHIVED");

  async function toggleMilestone(g: Goal, m: Milestone) {
    try {
      await api.patch(`/api/goals/${g.id}/milestones/${m.id}`, { done: !m.done });
      await load();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }
  async function addMilestone(g: Goal, title: string) {
    if (!title.trim()) return;
    try {
      await api.post(`/api/goals/${g.id}/milestones`, { title });
      await load();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }
  async function removeGoal() {
    if (!del) return;
    try {
      await api.delete(`/api/goals/${del.id}`);
      setDel(null);
      await load();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }
  async function setStatus(g: Goal, status: Goal["status"]) {
    try {
      await api.patch(`/api/goals/${g.id}`, { status });
      await load();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  return (
    <div>
      <PageHeader
        title="Hedefler ve öğrenme"
        subtitle="Uzun vadeli hedefleri küçük aşamalara böl; ders notları ve kelimeleri burada tut."
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Hedef
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {areas.map((a) => (
          <button key={a} onClick={() => setArea(a)} className={`chip cursor-pointer border px-2.5 py-1 ${area === a ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200" : "border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300"}`}>
            {a === "all" ? "Tümü" : AREA_LABEL(a)}
          </button>
        ))}
      </div>
      {loading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <Empty text="Bu alanda hedef yok." action={<button className="btn-primary" onClick={() => setOpen(true)}>Hedef ekle</button>} />
      ) : (
        <div className="space-y-3">
          {visible.map((g) => (
            <div key={g.id} className="card">
              <div className="flex items-start gap-3 p-4">
                <button className="mt-0.5 text-slate-400" onClick={() => setExpanded(expanded === g.id ? null : g.id)}>
                  {expanded === g.id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className={`font-semibold ${g.status === "COMPLETED" ? "text-slate-400 line-through" : ""}`}>{g.title}</h3>
                    <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{AREA_LABEL(g.area)}</span>
                    {g.status === "PAUSED" && <span className="chip bg-amber-100 text-amber-800">Duraklatıldı</span>}
                    {g.status === "COMPLETED" && <span className="chip bg-emerald-100 text-emerald-700">Tamamlandı</span>}
                  </div>
                  {g.description && <p className="mt-0.5 text-sm text-slate-500">{g.description}</p>}
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex-1">
                      <Progress value={g.progress} color="bg-brand-500" />
                    </div>
                    <span className="text-xs text-slate-500">
                      %{g.progress} · {g.milestones.filter((m) => m.done).length}/{g.milestones.length} aşama
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {g.tasksDone} görev tamamlandı · {Math.round(g.minutesDone / 60)} sa çalışıldı · {g._count.notes} not{g.targetDate ? ` · hedef tarih ${g.targetDate}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {g.status === "ACTIVE" ? (
                    <button className="btn-ghost text-xs" onClick={() => setStatus(g, "PAUSED")}>
                      Duraklat
                    </button>
                  ) : g.status === "PAUSED" ? (
                    <button className="btn-ghost text-xs" onClick={() => setStatus(g, "ACTIVE")}>
                      Sürdür
                    </button>
                  ) : null}
                  <button className="btn-ghost p-1.5 text-red-600" onClick={() => setDel(g)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              {expanded === g.id && <GoalDetail g={g} onToggle={toggleMilestone} onAddMilestone={addMilestone} />}
            </div>
          ))}
        </div>
      )}
      <GoalForm open={open} onClose={() => setOpen(false)} onSaved={load} />
      <Confirm open={!!del} onClose={() => setDel(null)} onConfirm={removeGoal} title="Hedefi sil" text="Hedef, aşamaları ve notları silinecek. Bu işlem geri alınamaz." danger />
    </div>
  );
}

function GoalDetail({ g, onToggle, onAddMilestone }: { g: Goal; onToggle: (g: Goal, m: Milestone) => void; onAddMilestone: (g: Goal, t: string) => void }) {
  const { toast } = useStore();
  const [newM, setNewM] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [kind, setKind] = useState<"note" | "vocab">("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const loadNotes = async () => {
    try {
      const r = await api.get<{ notes: Note[] }>(`/api/notes?goalId=${g.id}`);
      setNotes(r.notes);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  useEffect(() => {
    loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.id]);

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api.post("/api/notes", { goalId: g.id, kind, title, content });
      setTitle("");
      setContent("");
      await loadNotes();
    } catch (err) {
      toast(errorText(err), "error");
    }
  }
  async function toggleMastered(n: Note) {
    try {
      await api.patch(`/api/notes/${n.id}`, { mastered: !n.mastered });
      await loadNotes();
    } catch (err) {
      toast(errorText(err), "error");
    }
  }
  async function delNote(n: Note) {
    try {
      await api.delete(`/api/notes/${n.id}`);
      await loadNotes();
    } catch (err) {
      toast(errorText(err), "error");
    }
  }

  const vocab = notes.filter((n) => n.kind === "vocab");
  const plain = notes.filter((n) => n.kind !== "vocab");

  return (
    <div className="grid gap-4 border-t border-slate-200 p-4 dark:border-slate-800 md:grid-cols-2">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Aşamalar</h4>
        <ul className="space-y-1">
          {g.milestones.map((m) => (
            <li key={m.id}>
              <button onClick={() => onToggle(g, m)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${m.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 dark:border-slate-600"}`}>{m.done && <Check size={11} />}</span>
                <span className={m.done ? "text-slate-400 line-through" : ""}>{m.title}</span>
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onAddMilestone(g, newM);
            setNewM("");
          }}
        >
          <input className="input" placeholder="Yeni aşama" value={newM} onChange={(e) => setNewM(e.target.value)} />
          <button className="btn-secondary shrink-0">
            <Plus size={15} />
          </button>
        </form>
      </div>
      <div>
        <h4 className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <BookOpen size={13} /> Notlar ve kelimeler
        </h4>
        <form onSubmit={addNote} className="space-y-2 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
          <div className="flex gap-2">
            <select className="input w-28 shrink-0" value={kind} onChange={(e) => setKind(e.target.value as "note" | "vocab")}>
              <option value="note">Not</option>
              <option value="vocab">Kelime</option>
            </select>
            <input className="input" placeholder={kind === "vocab" ? "Kelime" : "Başlık"} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <input className="input" placeholder={kind === "vocab" ? "Anlamı / örnek cümle" : "İçerik"} value={content} onChange={(e) => setContent(e.target.value)} />
            <button className="btn-primary shrink-0">Ekle</button>
          </div>
        </form>
        {vocab.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] text-slate-500">
              Kelimeler · {vocab.filter((v) => v.mastered).length}/{vocab.length} öğrenildi
            </div>
            <ul className="space-y-1">
              {vocab.map((n) => (
                <li key={n.id} className="flex items-start gap-2 text-sm">
                  <button onClick={() => toggleMastered(n)} className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border ${n.mastered ? "border-emerald-500 bg-emerald-500" : "border-slate-300"}`} title="Öğrendim" />
                  <span className="flex-1">
                    <span className={`font-medium ${n.mastered ? "text-slate-400 line-through" : ""}`}>{n.title}</span>
                    {n.content && <span className="text-slate-500"> — {n.content}</span>}
                  </span>
                  <button className="text-slate-400 hover:text-red-600" onClick={() => delNote(n)}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {plain.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {plain.map((n) => (
              <li key={n.id} className="rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{n.title}</span>
                  <button className="text-slate-400 hover:text-red-600" onClick={() => delNote(n)}>
                    <Trash2 size={13} />
                  </button>
                </div>
                {n.content && <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">{n.content}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function GoalForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast, categories } = useStore();
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("english");
  const [customArea, setCustomArea] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [milestones, setMilestones] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setArea("english");
    setCustomArea("");
    setDescription("");
    setTargetDate("");
    setCategoryId("");
    setMilestones(LEARNING_AREAS.find((a) => a.key === "english")?.topics ?? []);
  }, [open]);

  useEffect(() => {
    const a = LEARNING_AREAS.find((x) => x.key === area);
    setMilestones(a?.topics ?? []);
  }, [area]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/goals", {
        title,
        area: area === "custom" ? customArea.trim().toLowerCase() || "general" : area,
        description: description || null,
        targetDate: targetDate || null,
        categoryId: categoryId || null,
        milestones: milestones.filter((m) => m.trim()),
      });
      toast("Hedef oluşturuldu", "success");
      onSaved();
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Yeni hedef" wide>
      <form onSubmit={submit} className="space-y-3">
        <input className="input" placeholder="Örn. B2 seviyesine ulaş" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        <div className="grid gap-2 md:grid-cols-3">
          <div>
            <label className="label">Alan</label>
            <select className="input" value={area} onChange={(e) => setArea(e.target.value)}>
              {LEARNING_AREAS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
              <option value="custom">Yeni alan…</option>
            </select>
            {area === "custom" && <input className="input mt-1" placeholder="Alan adı" value={customArea} onChange={(e) => setCustomArea(e.target.value)} />}
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
          <div>
            <label className="label">Hedef tarih</label>
            <input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
        </div>
        <textarea className="input" rows={2} placeholder="Açıklama (isteğe bağlı)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div>
          <label className="label">Aşamalar (düzenleyebilirsin)</label>
          <div className="space-y-1.5">
            {milestones.map((m, i) => (
              <div key={i} className="flex gap-2">
                <input className="input" value={m} onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? e.target.value : x)))} />
                <button type="button" className="btn-ghost p-2" onClick={() => setMilestones(milestones.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="text-xs font-medium text-brand-600 hover:underline" onClick={() => setMilestones([...milestones, ""])}>
              + Aşama ekle
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button className="btn-primary" disabled={busy}>
            Oluştur
          </button>
        </div>
      </form>
    </Modal>
  );
}
