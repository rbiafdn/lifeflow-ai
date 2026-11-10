// Haftalık değerlendirme: gerçek istatistikler hesaplanır, Claude yalnızca yorumlar.

import { anthropic, MODEL } from "./client";
import { aiEnabled, assertWithinLimit, recordUsage } from "./usage";
import { db, save, nowIso, CoreError } from "../db";
import { computeStats } from "../stats";
import { addDays, weekStart, todayLocal, formatDateTR, WEEKDAY_SHORT_TR, weekday } from "../../shared/time";

export function cachedReview(anyDate: string) {
  const ws = weekStart(anyDate);
  const c = db().weeklyReviews.find((r) => r.weekStart === ws);
  return c ? { weekStart: ws, weekEnd: addDays(ws, 6), content: c.content, stats: c.stats, cached: true } : null;
}

export async function weeklyReview(anyDate = todayLocal(), force = false) {
  const ws = weekStart(anyDate);
  const we = addDays(ws, 6);
  const d = db();
  if (!force) {
    const cached = d.weeklyReviews.find((r) => r.weekStart === ws);
    if (cached && (we < todayLocal() || Date.now() - new Date(cached.createdAt).getTime() < 12 * 3600 * 1000)) {
      return { weekStart: ws, weekEnd: we, content: cached.content, stats: cached.stats, cached: true };
    }
  }
  if (!aiEnabled()) throw new CoreError(503, "Claude API anahtarı tanımlı değil. Ayarlar › Yapay zekâ bölümünden ekleyin.");
  assertWithinLimit();

  const stats = computeStats(ws, we);
  const loadByDay: Record<string, number> = {};
  for (const t of d.tasks) if (t.date >= addDays(ws, 7) && t.date <= addDays(ws, 13) && t.status === "PLANNED") loadByDay[t.date] = (loadByDay[t.date] ?? 0) + t.durationMinutes;

  const summary = {
    hafta: `${formatDateTR(ws, false)} - ${formatDateTR(we, false)}`,
    tamamlanmaOrani: stats.completionRate,
    toplam: stats.totals,
    ertelemeSayisi: stats.postponeEvents,
    gunler: stats.byDay.map((x) => `${WEEKDAY_SHORT_TR[weekday(x.date)]}: ${x.done}/${x.total} (${x.minutesDone} dk)`),
    kategoriler: stats.byCategory.map((c) => `${c.name}: ${c.minutesDone}/${c.minutesPlanned} dk yapıldı${c.weeklyTarget ? `, hedef ${c.weeklyTarget} dk (%${Math.round((c.minutesDone / c.weeklyTarget) * 100)})` : ""}, ${c.done}/${c.total} görev`),
    aliskanliklar: stats.habits.map((h) => `${h.name}: ${h.done}/${h.expected} (%${h.rate}), seri ${h.streak}`),
    uyku: stats.sleep.avgMinutes ? `ortalama ${Math.round(stats.sleep.avgMinutes / 6) / 10} sa (planlanan ${Math.round(stats.sleep.plannedMinutes / 6) / 10} sa)` : "kayıt yok",
    gelecekHaftaYuk: Object.entries(loadByDay).sort().map(([k, m]) => `${WEEKDAY_SHORT_TR[weekday(k)]} ${m} dk`),
  };

  const response = await anthropic().messages.create({
    model: MODEL(),
    max_tokens: 1500,
    output_config: { effort: "low" },
    system:
      "Sen LifeFlow AI'sın. Kullanıcının haftalık verilerini değerlendirirsin. Türkçe, samimi ve kısa yaz (en fazla 180 kelime). Yalnızca verilen sayılara dayan; veri yoksa 'bu hafta veri yok' de, uydurma. Şu yapıyı kullan: 1) Öne çıkanlar (2-3 madde), 2) Dikkat edilmesi gerekenler (1-2 madde), 3) Gelecek hafta için somut 1-2 öneri. Günlerin yükünü ve ertelemeleri dikkate al.",
    messages: [{ role: "user", content: JSON.stringify(summary, null, 1) }],
  });
  recordUsage(response.usage.input_tokens, response.usage.output_tokens);
  const content = response.stop_reason === "refusal" ? "Değerlendirme üretilemedi." : response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();

  const idx = d.weeklyReviews.findIndex((r) => r.weekStart === ws);
  const rec = { weekStart: ws, content, stats, createdAt: nowIso() };
  if (idx === -1) d.weeklyReviews.push(rec);
  else d.weeklyReviews[idx] = rec;
  save();
  return { weekStart: ws, weekEnd: we, content, stats, cached: false };
}
