// Claude destekli kişisel asistan.
// Model veritabanına doğrudan erişmez; yalnızca salt okunur bağlam araçları ve
// doğrulanmış operasyonlar üreten "propose_changes" aracı vardır. Değişiklikler
// kullanıcı onayından sonra uygulanır.

import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { anthropic, MODEL } from "./client";
import { assertWithinLimit, recordUsage } from "./usage";
import { prisma } from "../db";
import { HttpError, badRequest } from "../lib/errors";
import { aiEnabled } from "../config";
import { buildContext, runScenario, freeSlotsFor } from "../services/planner";
import { validateOperations, type InternalOp } from "../services/operations";
import { addDays, todayLocal, formatDateTR, WEEKDAY_NAMES_TR, weekday } from "../../shared/time";
import type { ChatMessage, ProposalDTO } from "../../shared/types";

type BetaTool = Anthropic.Beta.Messages.BetaTool;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;

const SYSTEM_PROMPT = `Sen LifeFlow AI'sın: kullanıcının kişisel yaşam ve zaman yönetimi asistanı. Türkçe konuşursun; kısa, net ve samimi yazarsın.

Görevin: kullanıcının programını, görevlerini, hedeflerini ve kısıtlarını anlayıp gerçek planlama yapmak.

Kurallar:
- Veritabanını doğrudan değiştiremezsin. Değişiklik önermek için her zaman propose_changes aracını kullan; kullanıcı önizlemeyi onayladıktan sonra sistem uygular.
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
      input_schema: {
        type: "object",
        properties: {
          from: { type: "string", description: "YYYY-MM-DD" },
          to: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "get_free_slots",
      description: "Bir gündeki boş zaman dilimlerini (uyanıklık, iş saatleri ve planlı görevler düşüldükten sonra) döndürür.",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          durationMinutes: { type: "integer", description: "İsteğe bağlı: en az bu kadar uzun dilimler" },
        },
        required: ["date"],
        additionalProperties: false,
      },
    },
    {
      name: "run_scenario",
      description:
        "Deterministik yeniden planlama motorunu çalıştırır ve önerilen operasyonları, gerekçeleri ve uyarıları döndürür. Senaryolar: move (görevi taşı: taskId, targetDate, targetTime?), postpone (taskId, minutes), free_window (date, start, end, blockTitle?, blockTimeType? 'FIXED'|'REST'), failed (taskId, reschedule), lighten_week (date?), catch_up (horizonDays?, aggressive?), plan_day (date, suggestions?[{title, categoryId?, durationMinutes, priority?, timeType?, difficulty?, goalId?, reason?}], includeBacklog?). Sonuç otomatik olarak saklanır; propose_changes'te include_scenario_results=true ile kullanılabilir.",
      input_schema: {
        type: "object",
        properties: {
          scenario: { type: "string", enum: ["move", "postpone", "free_window", "failed", "lighten_week", "catch_up", "plan_day"] },
          params: { type: "object", description: "Senaryoya özgü parametreler" },
        },
        required: ["scenario", "params"],
      },
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
  scenarioNotes: string[];
  proposal: ProposalDTO | null;
}

async function contextBlock(userId: string, today: string): Promise<string> {
  const from = addDays(today, -3);
  const to = addDays(today, 7);
  const ctx = await buildContext(userId, from, to, today);
  const [categories, habits, goals, backlogCount] = await Promise.all([
    prisma.category.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } }),
    prisma.habit.findMany({ where: { userId, active: true }, select: { id: true, name: true, frequency: true, weeklyTarget: true } }),
    prisma.goal.findMany({ where: { userId, status: "ACTIVE" }, select: { id: true, title: true, area: true, targetDate: true, milestones: { where: { done: false }, orderBy: { sortOrder: "asc" }, take: 2, select: { title: true } } } }),
    prisma.task.count({ where: { userId, date: { lt: today }, status: "PLANNED" } }),
  ]);
  const s = ctx.settings;
  const lines: string[] = [];
  lines.push(`BUGÜN: ${today} (${WEEKDAY_NAMES_TR[weekday(today)]})`);
  lines.push(
    `AYARLAR: uyanma ${s.wakeTime}, uyku ${s.sleepTime}; iş ${s.workStart}-${s.workEnd} günler [${s.workDays.join(",")}] (+${s.commuteMinutes} dk yol); odak ${s.focusStart}-${s.focusEnd}; günlük dinlenme payı ${s.dailyFreeMinutes} dk; spor günleri [${s.sportDays.join(",")}]; dinlenme günleri [${s.restDays.join(",")}] (0=Pazar)`,
  );
  lines.push(`KATEGORİLER: ${categories.map((c) => `${c.name}=${c.id}${c.weeklyTargetMinutes ? ` (hedef ${c.weeklyTargetMinutes} dk/hafta)` : ""}`).join("; ")}`);
  if (habits.length) lines.push(`ALIŞKANLIKLAR: ${habits.map((h) => `${h.name} (${h.frequency === "DAILY" ? "günlük" : h.weeklyTarget + "x/hafta"})`).join("; ")}`);
  if (goals.length) lines.push(`HEDEFLER: ${goals.map((g) => `${g.title} [${g.area}] id=${g.id}${g.milestones.length ? " sıradaki: " + g.milestones.map((m) => m.title).join(", ") : ""}`).join("; ")}`);
  if (backlogCount) lines.push(`BİRİKEN (geçmiş tarihli, planlı) GÖREV: ${backlogCount}`);
  lines.push(`GÖREVLER (${from} → ${to}):`);
  const byDate = new Map<string, typeof ctx.tasks>();
  for (const t of ctx.tasks) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  for (const [date, list] of [...byDate.entries()].sort()) {
    lines.push(`  ${date} ${WEEKDAY_NAMES_TR[weekday(date)]}: ${list
      .map(
        (t) =>
          `[${t.id}] ${t.title} ${t.startTime ?? "saatsiz"} ${t.durationMinutes}dk ${t.timeType}/${t.priority} esneklik=${t.flexibility}${t.categoryId ? " " + (catName.get(t.categoryId) ?? "") : ""}${t.status !== "PLANNED" ? " " + t.status : ""}${t.deadline ? " son:" + t.deadline : ""}`,
      )
      .join(" | ")}`);
  }
  if (byDate.size === 0) lines.push("  (bu aralıkta görev yok)");
  return lines.join("\n");
}

async function execTool(userId: string, name: string, input: unknown, state: TurnState, today: string): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "get_tasks": {
      const from = String(args.from);
      const to = String(args.to);
      const ctx = await buildContext(userId, from, to, today);
      return JSON.stringify(
        ctx.tasks.map((t) => ({ id: t.id, title: t.title, date: t.date, startTime: t.startTime, durationMinutes: t.durationMinutes, priority: t.priority, timeType: t.timeType, flexibility: t.flexibility, status: t.status, categoryId: t.categoryId, deadline: t.deadline })),
      );
    }
    case "get_free_slots": {
      const res = await freeSlotsFor(userId, String(args.date), typeof args.durationMinutes === "number" ? args.durationMinutes : undefined);
      return JSON.stringify(res);
    }
    case "run_scenario": {
      const outcome = await runScenario(userId, { scenario: args.scenario, ...((args.params as object) ?? {}) }, today);
      state.scenarioOps.push(...(outcome.operations as InternalOp[]));
      state.scenarioNotes.push(...outcome.explanation);
      return JSON.stringify({
        operations: outcome.operations,
        explanation: outcome.explanation,
        warnings: outcome.warnings,
        affected: outcome.affected.map((a) => ({ id: a.id, title: a.title, date: a.date, startTime: a.startTime })),
      });
    }
    case "propose_changes": {
      const ops: InternalOp[] = [];
      if (args.include_scenario_results) ops.push(...state.scenarioOps);
      if (Array.isArray(args.operations)) ops.push(...(args.operations as InternalOp[]));
      if (ops.length === 0) return JSON.stringify({ error: "Operasyon yok. include_scenario_results=true verin veya operations ekleyin." });
      try {
        const v = await validateOperations(userId, ops);
        const proposal = await prisma.aiProposal.create({
          data: {
            userId,
            summary: String(args.summary ?? "Değişiklik önerisi"),
            rationale: String(args.rationale ?? ""),
            operations: v.operations as unknown as Prisma.InputJsonValue,
            preview: { lines: v.preview, warnings: v.warnings } as unknown as Prisma.InputJsonValue,
          },
        });
        state.proposal = {
          id: proposal.id,
          summary: proposal.summary,
          rationale: proposal.rationale,
          operations: v.operations as ProposalDTO["operations"],
          preview: v.preview,
          warnings: v.warnings,
          status: "PENDING",
          createdAt: proposal.createdAt.toISOString(),
        };
        return JSON.stringify({ ok: true, proposalId: proposal.id, operationCount: v.operations.length, warnings: v.warnings, message: "Öneri kaydedildi ve kullanıcıya önizleme olarak gösterilecek. Kısa bir açıklama yazıp bitir." });
      } catch (e) {
        const msg = e instanceof HttpError ? e.message : String(e);
        return JSON.stringify({ error: msg });
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

export async function runAssistant(userId: string, history: ChatMessage[], message: string): Promise<AssistantResult> {
  if (!aiEnabled()) throw new HttpError(503, "Claude API anahtarı tanımlı değil (ANTHROPIC_API_KEY).");
  if (!message.trim()) throw badRequest("Mesaj boş olamaz.");
  await assertWithinLimit(userId);

  const today = todayLocal();
  const context = await contextBlock(userId, today);
  const trimmed = history.slice(-MAX_HISTORY).filter((m) => m.content.trim());
  const messages: BetaMessageParam[] = [
    ...trimmed.map<BetaMessageParam>((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: `<bağlam>\n${context}\n</bağlam>\n\n${message}` },
  ];

  const state: TurnState = { scenarioOps: [], scenarioNotes: [], proposal: null };
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
        content = await execTool(userId, tu.name, tu.input, state, today);
      } catch (e) {
        isError = true;
        content = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content, is_error: isError });
    }
    messages.push({ role: "user", content: results });
  }

  await recordUsage(userId, totalIn, totalOut);
  if (!reply) reply = state.proposal ? "Önerimi hazırladım; önizlemeyi inceleyip onaylayabilirsin." : "Bir yanıt üretemedim, lütfen tekrar dene.";
  return { reply, proposal: state.proposal };
}

export function formatDateForPrompt(date: string) {
  return formatDateTR(date);
}
