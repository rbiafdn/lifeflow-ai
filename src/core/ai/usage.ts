import { db, save, CoreError } from "../db";
import { todayLocal } from "../../shared/time";

export function aiEnabled(): boolean {
  return db().ai.apiKey.trim().length > 0;
}

export function assertWithinLimit() {
  const d = db();
  const u = d.aiUsage[todayLocal()];
  if (u && u.calls >= d.ai.dailyLimit) throw new CoreError(429, `Günlük AI çağrı sınırına ulaşıldı (${d.ai.dailyLimit}). Yarın tekrar deneyin veya Ayarlar'dan sınırı artırın.`);
}

export function recordUsage(inputTokens: number, outputTokens: number) {
  const d = db();
  const date = todayLocal();
  const u = d.aiUsage[date] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
  u.calls++;
  u.inputTokens += inputTokens;
  u.outputTokens += outputTokens;
  d.aiUsage[date] = u;
  // Eski günleri temizle (son 30 gün)
  for (const k of Object.keys(d.aiUsage)) if (k < todayLocal().slice(0, 8) + "01" && Object.keys(d.aiUsage).length > 40) delete d.aiUsage[k];
  save();
}

export function usageSummary() {
  const d = db();
  const date = todayLocal();
  const u = d.aiUsage[date];
  return { date, calls: u?.calls ?? 0, limit: d.ai.dailyLimit, inputTokens: u?.inputTokens ?? 0, outputTokens: u?.outputTokens ?? 0 };
}
