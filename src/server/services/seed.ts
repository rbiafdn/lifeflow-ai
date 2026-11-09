import { prisma } from "../db";
import { DEFAULT_CATEGORIES } from "../../shared/defaults";

/** Yeni kullanıcı için varsayılan ayarlar ve kategoriler. */
export async function seedUser(userId: string) {
  await prisma.userSettings.upsert({ where: { userId }, update: {}, create: { userId } });
  const existing = await prisma.category.count({ where: { userId } });
  if (existing > 0) return;
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c, i) => ({ ...c, userId, isDefault: true, sortOrder: i })),
    skipDuplicates: true,
  });
}

export async function restCategoryId(userId: string): Promise<string | null> {
  const c = await prisma.category.findFirst({ where: { userId, name: "Dinlenme" }, select: { id: true } });
  return c?.id ?? null;
}
