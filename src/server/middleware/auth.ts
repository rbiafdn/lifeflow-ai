import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config, isProd } from "../config";
import { unauthorized } from "../lib/errors";

export interface AuthUser {
  id: string;
  email: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: "30d" });
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(config.cookieName, { path: "/" });
}

function extractToken(req: Request): string | null {
  const cookie = req.cookies?.[config.cookieName];
  if (cookie) return cookie;
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return null;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string; email: string };
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    next(unauthorized("Oturum geçersiz veya süresi dolmuş."));
  }
}

export function userId(req: Request): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}
