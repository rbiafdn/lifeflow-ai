import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { parse } from "../lib/validate";
import { userId } from "../middleware/auth";
import { settingsSchema, categorySchema } from "../services/schemas";
import { badRequest, notFound } from "../lib/errors";

export const settingsRouter = Router();

settingsRouter.get("/", async (req, res) => {
  const uid = userId(req);
  const s = await prisma.userSettings.upsert({ where: { userId: uid }, update: {}, create: { userId: uid } });
  res.json({ settings: s });
});

settingsRouter.put("/", async (req, res) => {
  const uid = userId(req);
  const data = parse(settingsSchema, req.body);
  const s = await prisma.userSettings.upsert({
    where: { userId: uid },
    update: data as Prisma.UserSettingsUncheckedUpdateInput,
    create: { ...(data as Omit<Prisma.UserSettingsUncheckedCreateInput, "userId">), userId: uid },
  });
  res.json({ settings: s });
});

export const categoriesRouter = Router();

categoriesRouter.get("/", async (req, res) => {
  const categories = await prisma.category.findMany({ where: { userId: userId(req) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  res.json({ categories });
});

categoriesRouter.post("/", async (req, res) => {
  const uid = userId(req);
  const data = parse(categorySchema, req.body);
  const dup = await prisma.category.findUnique({ where: { userId_name: { userId: uid, name: data.name } } });
  if (dup) throw badRequest("Bu isimde bir kategori zaten var.");
  const count = await prisma.category.count({ where: { userId: uid } });
  const category = await prisma.category.create({ data: { ...data, userId: uid, sortOrder: data.sortOrder ?? count } });
  res.status(201).json({ category });
});

categoriesRouter.patch("/:id", async (req, res) => {
  const uid = userId(req);
  const data = parse(categorySchema.partial(), req.body);
  const existing = await prisma.category.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!existing) throw notFound("Kategori");
  const category = await prisma.category.update({ where: { id: existing.id }, data });
  res.json({ category });
});

categoriesRouter.delete("/:id", async (req, res) => {
  const uid = userId(req);
  const existing = await prisma.category.findFirst({ where: { id: req.params.id as string, userId: uid } });
  if (!existing) throw notFound("Kategori");
  await prisma.category.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});
