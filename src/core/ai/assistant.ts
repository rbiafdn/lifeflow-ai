// Claude destekli kişisel asistan (tarayıcıda çalışır).
// Model veriye doğrudan erişmez; salt okunur bağlam araçları ve doğrulanmış
// operasyonlar üreten "propose_changes" aracı vardır. Değişiklikler onaydan sonra uygulanır.

import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "./client";
import { aiEnabled, assertWithinLimit, recordUsage } from "./usage";
import { db, save, newId, nowIso, CoreError, badRequest, type ProposalRec } from "../db";
import { buildContext, runScenario, freeSlotsFor } from "../planner";
import { validateOperations, type InternalOp } from "../operations";
import { addDays, todayLocal, WEEKDAY_NAMES_TR, weekday } from "../../shared/time";
import type { ChatMessage, ProposalDTO } from "../../shared/types";

type BetaTool = Anthropic.Beta.Messages.BetaTool;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;

export const SYSTEM_PROMPT = `Sen LifeFlow AI'sın: kullanıcının kişisel yaşam ve zaman yönetimi asistanı. Türkçe konuşursun; kısa, net ve samimi yazarsın.

Görevin: kullanıcının programını, görevlerini, hedeflerini ve kısıtlarını anlayıp gerçek planlama yapmak.

Kurallar:
- Veriyi doğrudan değiştiremezsin. Değişiklik önermek için her zaman propose_changes aracını kullan; kullanıcı önizlemeyi onayladıktan sonra sistem uygular.
- Sabit (FIXED) görevleri ve iş saatlerini kullanıcı açıkça istemeden taşıma. Uyku saatlerini koru (uyanma/uyku saatleri dışına görev koyma).
- Dinlenme (REST) zamanını tamamen kaldırma; gerekirse kısalt.
- Görev çakışması yaratma; aralara 10 dk tampon bırak. Gerçekçi süreler kullan.
- Aynı görevi iki kez oluşturma. Tamamlanmış görevleri silme veya değiştirme.
- Kullanıcı onayı olmadan bütün haftayı değiştirme; yalnızca isteğin gerektirdiği kadar değişiklik öner.
- Önce bağlamı incele (verilen bağlam yetmiyorsa get_tasks / get_free_slots kullan), sonra uygun senaryoyu run_scenario ile çalıştır. Senaryo sonuçları uygunsa propose_changes ile include_scenario_results=true kullanarak öner; gerekirse ek operasyon ekle veya kendi operasyonlarını yaz.
- Tarihler YYYY-MM-DD, saatler HH:mm biçimindedir. "yarın", "perşembe" gibi ifadeleri bağlamdaki bugünün tarihine göre çöz.
- Yıkıcı işlemlerde (silme, iptal, tüm haftayı değiştirme) önce kullanıcıya sor; sadece net onay varsa öner.
- Değişiklik önerdiğinde cevabında şunları kısa başlıklarla anlat: ne değişiyor, hangi görevler etkileniyor, neden. Önizleme kullanıcıya ayrıca gösterilir; operasyon listesini metin olarak tekrarlama.
- Sohbet veya soru ise araç kullanmadan doğrudan yanıt ver. İstatistik uydurma; yalnızca bağlamdaki verilere dayan.`;

function tools(): BetaTool[] {
  return [
    {
      name: "get_tasks",
      description: "Belirli tarih aralığındaki görevleri (id, başlık, tarih, saat, süre, öncelik, tür, durum) getirir. Bağlamda olmayan günler için kullan.",
      input_schema: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } }, required: ["from", "to"], additionalProperties: false },
      strict: true,
    },
    {
      name: "get_free_slots",
      description: "Bir gündeki boş zaman dilimlerini (uyanıklık, iş saatleri ve planlı görevler düşüldükten sonra) döndürür.",
      input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, durationMinutes: { type: "integer", description: "İsteğe bağlı: en az bu kadar uzun dilimler" } }, required: ["date"], additionalProperties: false },
    },
    {
      name: "run_scenario",
      description:
        "Deterministik yeniden planlama motorunu çalıştırır ve önerilen operasyonları, gerekçeleri ve uyarıları döndürür. Senaryolar: move (görevi taşı: taskId, targetDate, targetTime?), postpone (taskId, minutes), free_window (date, start, end, blockTitle?, blockTimeType? 'FIXED'|'REST'), failed (taskId, reschedule), lighten_week (date?), catch_up (horizonDays?, aggressive?), plan_day (date, suggestions?[{title, categoryId?, durationMinutes, priority?, timeType?, difficulty?, goalId?, reason?}], includeBacklog?). Sonuç otomatik olarak saklanır; propose_changes'te include_scenario_results=true ile kullanılabilir.",
      input_schema: { type: "object", properties: { scenario: { type: "string", enum: ["move", "postpone", "free_window", "failed", "lighten_week", "catch_up", "plan_day"] }, params: { type: "object", description: "Senaryoya özgü parametreler" } }, required: ["scenario", "params"] },
    },
    {
      name: "propose_changes",
      description:
        "Kullanıcı onayına sunulacak değişiklik önerisini kaydeder. Operasyon türleri: create {task:{title,date,startTime?,durationMinutes?,priority?,timeType?,flexibility?,categoryId?,deadline?,difficulty?,goalId?,notes?}, reason?}, update {taskId, changes:{date?,startTime?,durationMinutes?,title?,priority?,timeType?,status?,categoryId?,postponeCount?...}, reason?}, delete {taskId, reason?}. Bu araçtan sonra kısa bir açıklama yazıp bitir.",
      input_schema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Tek cümlelik özet" },
          rationale: { type: "string", description: "Değişikliklerin gerekçesi (kısa paragraf)" },
          include_scenario_results: { type: "boolean", description: "Bu sohbet turunda çalıştırılan senaryo operasyonlarını dahil et" },
          operations: { type: "array", items: { type: "object" }, description: "Ek veya elle yazılmış operasyonlar" },
        },
        required: ["summary", "rationale"],
      },
    },
  ];
}

interface TurnState {
  scenarioOps: InternalOp[];
  proposal: ProposalDTO | null;
}

export function contextBlock(today: string): string {
  const from = addDays(today, -3);
  const to = addDays(today, 7);
  const ctx = buildContext(from, to, today);
  const d = db();
  const s = ctx.settings;
  const lines: string[] = [];
  lines.push(`BUGÜN: ${today} (${WEEKDAY_NAMES_TR[weekday(today)]})`);
  lines.push(`AYARLAR: uyanma ${s.wakeTime}, uyku ${s.sleepTime}; iş ${s.workStart}-${s.workEnd} günler [${s.workDays.join(",")}] (+${s.commuteMinutes} dk yol); odak ${s.focusStart}-${s.focusEnd}; günlük dinlenme payı ${s.dailyFreeMinutes} dk; spor günleri [${s.sportDays.join(",")}]; dinlenme günleri [${s.restDays.join(",")}] (0=Pazar)`);
  lines.push(`KATEGORİLER: ${d.categories.map((c) => `${c.name}=${c.id}${c.weeklyTargetMinutes ? ` (hedef ${c.weeklyTargetMinutes} dk/hafta)` : ""}`).join("; ")}`);
  const habits = d.habits.filter((h) => h.active);
  if (habits.length) lines.push(`ALIŞKANLIKLAR: ${habits.map((h) => `${h.name} (${h.frequency === "DAILY" ? "günlük" : h.weeklyTarget + "x/hafta"})`).join("; ")}`);
  const goals = d.goals.filter((g) => g.status === "ACTIVE");
  if (goals.length) {
    lines.push(
      `HEDEFLER: ${goals
        .map((g) => {
          const next = d.milestones.filter((m) => m.goalId === g.id && !m.done).sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 2);
          return `${g.title} [${g.area}] id=${g.id}${next.length ? " sıradaki: " + next.map((m) => m.title).join(", ") : ""}`;
        })
        .join("; ")}`,
    );
  }
  const backlog = d.tasks.filter((t) => t.date < today && t.status === "PLANNED").length;
  if (backlog) lines.push(`BİRİKEN (geçmiş tarihli, planlı) GÖREV: ${backlog}`);
  lines.push(`GÖREVLER (${from} → ${to}):`);
  const byDate = new Map<string, typeof ctx.tasks>();
  for (const t of ctx.tasks) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  const catName = new Map(d.categories.map((c) => [c.id, c.name]));
  for (const [date, list] of [...byDate.entries()].sort()) {
    lines.push(
      `  ${date} ${WEEKDAY_NAMES_TR[weekday(date)]}: ${list
        .map((t) => `[${t.id}] ${t.title} ${t.startTime ?? "saatsiz"} ${t.durationMinutes}dk ${t.timeType}/${t.priority} esneklik=${t.flexibility}${t.categoryId ? " " + (catName.get(t.categoryId) ?? "") : ""}${t.status !== "PLANNED" ? " " + t.status : ""}${t.deadline ? " son:" + t.deadline : ""}`)
        .join(" | ")}`,
    );
  }
  if (byDate.size === 0) lines.push("  (bu aralıkta görev yok)");
  return lines.join("\n");
}

export function createProposal(summary: string, rationale: string, ops: InternalOp[]): ProposalDTO {
  const v = validateOperations(ops);
  const d = db();
  const rec = { id: newId(), summary, rationale, operations: v.operations, preview: { lines: v.preview, warnings: v.warnings }, status: "PENDING" as const, createdAt: nowIso(), resolvedAt: null };
  d.proposals.push(rec);
  save();
  return toProposalDTO(rec);
}

export function toProposalDTO(p: ProposalRec): ProposalDTO {
  return { id: p.id, summary: p.summary, rationale: p.rationale, operations: p.operations as ProposalDTO["operations"], preview: p.preview.lines, warnings: p.preview.warnings, status: p.status, createdAt: p.createdAt };
}

function execTool(name: string, input: unknown, state: TurnState, today: string): string {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "get_tasks": {
      const ctx = buildContext(String(args.from), String(args.to), today);
      return JSON.stringify(ctx.tasks.map((t) => ({ id: t.id, title: t.title, date: t.date, startTime: t.startTime, durationMinutes: t.durationMinutes, priority: t.priority, timeType: t.timeType, flexibility: t.flexibility, status: t.status, categoryId: t.categoryId, deadline: t.deadline })));
    }
    case "get_free_slots":
      return JSON.stringify(freeSlotsFor(String(args.date), typeof args.durationMinutes === "number" ? args.durationMinutes : undefined));
    case "run_scenario": {
      const outcome = runScenario({ scenario: args.scenario, ...((args.params as object) ?? {}) }, today);
      state.scenarioOps.push(...(outcome.operations as InternalOp[]));
      return JSON.stringify({ operations: outcome.operations, explanation: outcome.explanation, warnings: outcome.warnings, affected: outcome.affected.map((a) => ({ id: a.id, title: a.title, date: a.date, startTime: a.startTime })) });
    }
    case "propose_changes": {
      const ops: InternalOp[] = [];
      if (args.include_scenario_results) ops.push(...state.scenarioOps);
      if (Array.isArray(args.operations)) ops.push(...(args.operations as InternalOp[]));
      if (ops.length === 0) return JSON.stringify({ error: "Operasyon yok. include_scenario_results=true verin veya operations ekleyin." });
      try {
        const proposal = createProposal(String(args.summary ?? "Değişiklik önerisi"), String(args.rationale ?? ""), ops);
        state.proposal = proposal;
        return JSON.stringify({ ok: true, proposalId: proposal.id, operationCount: proposal.operations.length, warnings: proposal.warnings, message: "Öneri kaydedildi ve kullanıcıya önizleme olarak gösterilecek. Kısa bir açıklama yazıp bitir." });
      } catch (e) {
        return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
    }
    default:
      return JSON.stringify({ error: `Bilinmeyen araç: ${name}` });
  }
}

export interface AssistantResult {
  reply: string;
  proposal: ProposalDTO | null;
}

const MAX_HISTORY = 12;
const MAX_ITERATIONS = 10;

export async function runAssistant(history: ChatMessage[], message: string): Promise<AssistantResult> {
  if (!aiEnabled()) throw new CoreError(503, "Claude API anahtarı tanımlı değil. Ayarlar › Yapay zekâ bölümünden ekleyin.");
  if (!message.trim()) throw badRequest("Mesaj boş olamaz.");
  assertWithinLimit();

  const today = todayLocal();
  const context = contextBlock(today);
  const trimmed = history.slice(-MAX_HISTORY).filter((m) => m.content.trim());
  const messages: BetaMessageParam[] = [...trimmed.map<BetaMessageParam>((m) => ({ role: m.role, content: m.content })), { role: "user", content: `<bağlam>\n${context}\n</bağlam>\n\n${message}` }];

  const state: TurnState = { scenarioOps: [], proposal: null };
  const client = anthropic();
  let reply = "";
  let totalIn = 0;
  let totalOut = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.beta.messages.create({
      model: MODEL(),
      max_tokens: 6000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "medium" },
      tools: tools(),
      messages,
    });
    totalIn += response.usage.input_tokens;
    totalOut += response.usage.output_tokens;
    const text = response.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (text) reply = text;
    if (response.stop_reason === "refusal") {
      reply = reply || "Bu isteği işleyemedim. Lütfen farklı bir şekilde ifade edin.";
      break;
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const toolUses = response.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      let content: string;
      let isError = false;
      try {
        content = execTool(tu.name, tu.input, state, today);
      } catch (e) {
        isError = true;
        content = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content, is_error: isError });
    }
    messages.push({ role: "user", content: results });
  }
  recordUsage(totalIn, totalOut);
  if (!reply) reply = state.proposal ? "Önerimi hazırladım; önizlemeyi inceleyip onaylayabilirsin." : "Bir yanıt üretemedim, lütfen tekrar dene.";
  return { reply, proposal: state.proposal };
}
