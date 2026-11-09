// Haftalık değerlendirme: gerçek istatistikler hesaplanır, Claude yalnızca yorumlar.

import type { Prisma } from "@prisma/client";
import { anthropic, MODEL } from "./client";
import { assertWithinLimit, recordUsage } from "./usage";
import { prisma } from "../db";
import { aiEnabled } from "../config";
import { HttpError } from "../lib/errors";
import { computeStats } from "../services/stats";
import { addDays, weekStart, todayLocal, formatDateTR, WEEKDAY_SHORT_TR, weekday } from "../../shared/time";

export async function weeklyReview(userId: string, anyDate = todayLocal(), force = false) {
  const ws = weekStart(anyDate);
  const we = addDays(ws, 6);
  if (!force) {
    const cached = await prisma.weeklyReview.findUnique({ where: { userId_weekStart: { userId, weekStart: ws } } });
    // Hafta bitmişse önbellek kalıcı; devam eden haftada 12 saatlik önbellek
    if (cached && (we < todayLocal() || Date.now() - cached.createdAt.getTime() < 12 * 3600 * 1000)) {
      return { weekStart: ws, weekEnd: we, content: cached.content, stats: cached.stats, cached: true };
    }
  }
  if (!aiEnabled()) throw new HttpError(503, "Claude API anahtarı tanımlı değil (ANTHROPIC_API_KEY).");
  await assertWithinLimit(userId);

  const stats = await computeStats(userId, ws, we);
  const nextWeekTasks = await prisma.task.findMany({ where: { userId, date: { gte: addDays(ws, 7), lte: addDays(ws, 13) }, status: "PLANNED" }, select: { date: true, durationMinutes: true } });
  const loadByDay: Record<string, number> = {};
  for (const t of nextWeekTasks) loadByDay[t.date] = (loadByDay[t.date] ?? 0) + t.durationMinutes;

  const summary = {
    hafta: `${formatDateTR(ws, false)} - ${formatDateTR(we, false)}`,
    tamamlanmaOrani: stats.completionRate,
    toplam: stats.totals,
    ertelemeSayisi: stats.postponeEvents,
    gunler: stats.byDay.map((d) => `${WEEKDAY_SHORT_TR[weekday(d.date)]}: ${d.done}/${d.total} (${d.minutesDone} dk)`),
    kategoriler: stats.byCategory.map((c) => `${c.name}: ${c.minutesDone}/${c.minutesPlanned} dk yapıldı${c.weeklyTarget ? `, hedef ${c.weeklyTarget} dk (%${Math.round((c.minutesDone / c.weeklyTarget) * 100)})` : ""}, ${c.done}/${c.total} görev`),
    aliskanliklar: stats.habits.map((h) => `${h.name}: ${h.done}/${h.expected} (%${h.rate}), seri ${h.streak}`),
    uyku: stats.sleep.avgMinutes ? `ortalama ${Math.round(stats.sleep.avgMinutes / 6) / 10} sa (planlanan ${Math.round(stats.sleep.plannedMinutes / 6) / 10} sa)` : "kayıt yok",
    gelecekHaftaYuk: Object.entries(loadByDay).sort().map(([d, m]) => `${WEEKDAY_SHORT_TR[weekday(d)]} ${m} dk`),
  };

  const client = anthropic();
  const response = await client.messages.create({
    model: MODEL(),
    max_tokens: 1500,
    output_config: { effort: "low" },
    system:
      "Sen LifeFlow AI'sın. Kullanıcının haftalık verilerini değerlendirirsin. Türkçe, samimi ve kısa yaz (en fazla 180 kelime). Yalnızca verilen sayılara dayan; veri yoksa 'bu hafta veri yok' de, uydurma. Şu yapıyı kullan: 1) Öne çıkanlar (2-3 madde), 2) Dikkat edilmesi gerekenler (1-2 madde), 3) Gelecek hafta için somut 1-2 öneri. Günlerin yükünü ve ertelemeleri dikkate al.",
    messages: [{ role: "user", content: JSON.stringify(summary, null, 1) }],
  });
  await recordUsage(userId, response.usage.input_tokens, response.usage.output_tokens);
  const content = response.stop_reason === "refusal"
    ? "Değerlendirme üretilemedi."
    : response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();

  await prisma.weeklyReview.upsert({
    where: { userId_weekStart: { userId, weekStart: ws } },
    create: { userId, weekStart: ws, content, stats: stats as unknown as Prisma.InputJsonValue },
    update: { content, stats: stats as unknown as Prisma.InputJsonValue, createdAt: new Date() },
  });
  return { weekStart: ws, weekEnd: we, content, stats, cached: false };
}
