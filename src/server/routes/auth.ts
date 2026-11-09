import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { parse } from "../lib/validate";
import { badRequest, unauthorized } from "../lib/errors";
import { requireAuth, signToken, setAuthCookie, clearAuthCookie, userId } from "../middleware/auth";
import { seedUser } from "../services/seed";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı").max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

authRouter.post("/register", async (req, res) => {
  const data = parse(registerSchema, req.body);
  const exists = await prisma.user.findUnique({ where: { email: data.email } });
  if (exists) throw badRequest("Bu e-posta ile zaten bir hesap var.");
  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await prisma.user.create({ data: { name: data.name, email: data.email, passwordHash } });
  await seedUser(user.id);
  setAuthCookie(res, signToken({ id: user.id, email: user.email }));
  res.status(201).json({ user: { id: user.id, name: user.name, email: user.email } });
});

authRouter.post("/login", async (req, res) => {
  const data = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
    throw unauthorized("E-posta veya şifre hatalı.");
  }
  await seedUser(user.id);
  setAuthCookie(res, signToken({ id: user.id, email: user.email }));
  res.json({ user: { id: user.id, name: user.name, email: user.email } });
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: userId(req) }, select: { id: true, name: true, email: true, createdAt: true } });
  if (!user) throw unauthorized();
  res.json({ user });
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const data = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), password: z.string().min(8).max(128).optional() }), req.body);
  const update: { name?: string; passwordHash?: string } = {};
  if (data.name) update.name = data.name;
  if (data.password) update.passwordHash = await bcrypt.hash(data.password, 10);
  const user = await prisma.user.update({ where: { id: userId(req) }, data: update, select: { id: true, name: true, email: true } });
  res.json({ user });
});
