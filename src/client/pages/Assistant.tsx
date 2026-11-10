import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { Send, Sparkles, Trash2, Bot, User as UserIcon, Undo2 } from "lucide-react";
import { api } from "../lib/api";
import { useStore, errorText } from "../lib/store";
import { ProposalPanel } from "../components/ProposalPanel";
import { PageHeader } from "../components/ui";
import type { ChatMessage, ProposalDTO } from "@shared/types";

const EXAMPLES = [
  "Yarın için program hazırla.",
  "Bu hafta İngilizceye daha fazla zaman ayır.",
  "Bugünkü sporumu perşembeye taşı.",
  "Akşam misafir gelecek, programımı yeniden düzenle.",
  "Bu hafta çok yoruldum. Programımı hafiflet.",
  "Üç gündür programımı uygulayamadım.",
  "Yarın boşum, verimli bir gün planla.",
  "Yazılım çalışmalarımı artır ama uyku saatimi değiştirme.",
];

interface Status {
  enabled: boolean;
  model: string;
  usage: { calls: number; limit: number };
}

const KEY = "lifeflow-chat";

export function AssistantPage() {
  const { toast } = useStore();
  const loc = useLocation();
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [proposals, setProposals] = useState<ProposalDTO[]>([]);
  const [applying, setApplying] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  const loadStatus = async () => {
    try {
      const [s, p] = await Promise.all([api.get<Status>("/api/ai/status"), api.get<{ proposals: ProposalDTO[] }>("/api/ai/proposals")]);
      setStatus(s);
      setProposals(p.proposals);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* yok say */
    }
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const m = (loc.state as { message?: string } | null)?.message;
    if (m && !autoSent.current) {
      autoSent.current = true;
      send(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.state]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput("");
    const history = messages.slice(-12);
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setBusy(true);
    try {
      const r = await api.post<{ reply: string; proposal: ProposalDTO | null }>("/api/ai/chat", { message: msg, history });
      setMessages((m) => [...m, { role: "assistant", content: r.reply }]);
      if (r.proposal) setProposals((p) => [r.proposal!, ...p.filter((x) => x.id !== r.proposal!.id)]);
      loadStatus();
    } catch (e) {
      const err = errorText(e);
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${err}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function apply(p: ProposalDTO) {
    setApplying(p.id);
    try {
      await api.post(`/api/ai/proposals/${p.id}/apply`);
      toast("Değişiklikler uygulandı (geri alınabilir)", "success");
      setProposals((x) => x.filter((y) => y.id !== p.id));
      setMessages((m) => [...m, { role: "assistant", content: `✅ "${p.summary}" uygulandı.` }]);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setApplying(null);
    }
  }
  async function reject(p: ProposalDTO) {
    try {
      await api.post(`/api/ai/proposals/${p.id}/reject`);
      setProposals((x) => x.filter((y) => y.id !== p.id));
    } catch (e) {
      toast(errorText(e), "error");
    }
  }
  async function undo() {
    try {
      const r = await api.post<{ description: string }>("/api/operations/undo");
      toast(`Geri alındı: ${r.description}`, "success");
    } catch (e) {
      toast(errorText(e), "error");
    }
  }

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col md:h-[calc(100vh-4rem)]">
      <PageHeader
        title="Asistan"
        subtitle={status ? (status.enabled ? `${status.model} · bugün ${status.usage.calls}/${status.usage.limit} çağrı` : "Claude API anahtarı tanımlı değil") : undefined}
        actions={
          <>
            <button className="btn-secondary" onClick={undo} title="Son değişikliği geri al">
              <Undo2 size={15} /> Geri al
            </button>
            <button className="btn-ghost" onClick={() => setMessages([])} title="Sohbeti temizle">
              <Trash2 size={15} />
            </button>
          </>
        }
      />
      {status && !status.enabled && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Asistanın çalışması için Ayarlar › Yapay zekâ bölümüne Anthropic API anahtarını ekle. Takvimdeki yeniden planlama araçları (misafir, hafif hafta, telafi, günü planla) anahtar olmadan da çalışır.
        </div>
      )}

      <div className="card flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-200">
                <Sparkles size={22} />
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">Programını, hedeflerini ve ayarlarını bilen bir asistan. Değişiklikler onayından sonra uygulanır.</p>
              <div className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-1.5">
                {EXAMPLES.map((e) => (
                  <button key={e} onClick={() => send(e)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : ""}`}>
              {m.role === "assistant" && (
                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
                  <Bot size={15} />
                </span>
              )}
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${m.role === "user" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"}`}>{m.content}</div>
              {m.role === "user" && (
                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                  <UserIcon size={15} />
                </span>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand-500" /> Programın inceleniyor…
            </div>
          )}
          {proposals.map((p) => (
            <ProposalPanel key={p.id} p={p} onApply={() => apply(p)} onReject={() => reject(p)} busy={applying === p.id} />
          ))}
          <div ref={endRef} />
        </div>
        <form
          className="flex items-center gap-2 border-t border-slate-200 p-3 dark:border-slate-800"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input className="input" placeholder="Bir şey iste…" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy || (status ? !status.enabled : false)} />
          <button className="btn-primary shrink-0" disabled={busy || !input.trim()}>
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
