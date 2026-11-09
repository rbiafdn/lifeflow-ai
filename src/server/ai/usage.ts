import { prisma } from "../db";
import { config } from "../config";
import { HttpError } from "../lib/errors";
import { todayLocal } from "../../shared/time";

/** Günlük çağrı sınırını uygular (maliyet kontrolü). */
export async function assertWithinLimit(userId: string) {
  const date = todayLocal();
  const usage = await prisma.aiUsage.findUnique({ where: { userId_date: { userId, date } } });
  if (usage && usage.calls >= config.aiDailyLimit) {
    throw new HttpError(429, `Günlük AI çağrı sınırına ulaşıldı (${config.aiDailyLimit}). Yarın tekrar deneyin.`);
  }
}

export async function recordUsage(userId: string, inputTokens: number, outputTokens: number) {
  const date = todayLocal();
  await prisma.aiUsage.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, calls: 1, inputTokens, outputTokens },
    update: { calls: { increment: 1 }, inputTokens: { increment: inputTokens }, outputTokens: { increment: outputTokens } },
  });
}

export async function usageSummary(userId: string) {
  const date = todayLocal();
  const usage = await prisma.aiUsage.findUnique({ where: { userId_date: { userId, date } } });
  return { date, calls: usage?.calls ?? 0, limit: config.aiDailyLimit, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 };
}
