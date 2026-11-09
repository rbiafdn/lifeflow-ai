import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config, isProd, aiEnabled } from "./config";
import { HttpError } from "./lib/errors";
import { requireAuth } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { settingsRouter, categoriesRouter } from "./routes/settings";
import { tasksRouter, operationsRouter, replanRouter, recurrencesRouter } from "./routes/tasks";
import { habitsRouter, sleepRouter } from "./routes/habits";
import { goalsRouter, notesRouter } from "./routes/goals";
import { templatesRouter, statsRouter, dataRouter, aiRouter } from "./routes/misc";

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  cors({
    origin: config.clientOrigin ? config.clientOrigin.split(",").map((s) => s.trim()) : true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

// Basit istek sınırlama (bellek içi; serverless'ta örnek başına)
const hits = new Map<string, { count: number; reset: number }>();
app.use("/api/", (req, res, next) => {
  const key = req.ip ?? "anon";
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < now) hits.set(key, { count: 1, reset: now + 60_000 });
  else if (++entry.count > 300) return res.status(429).json({ error: "Çok fazla istek. Lütfen biraz bekleyin." });
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ai: aiEnabled(), model: config.anthropicModel, time: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/categories", requireAuth, categoriesRouter);
app.use("/api/tasks", requireAuth, tasksRouter);
app.use("/api/operations", requireAuth, operationsRouter);
app.use("/api/replan", requireAuth, replanRouter);
app.use("/api/recurrences", requireAuth, recurrencesRouter);
app.use("/api/habits", requireAuth, habitsRouter);
app.use("/api/sleep", requireAuth, sleepRouter);
app.use("/api/goals", requireAuth, goalsRouter);
app.use("/api/notes", requireAuth, notesRouter);
app.use("/api/templates", requireAuth, templatesRouter);
app.use("/api/stats", requireAuth, statsRouter);
app.use("/api/data", requireAuth, dataRouter);
app.use("/api/ai", requireAuth, aiRouter);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Uç nokta bulunamadı." });
});

// Production: derlenmiş istemciyi aynı süreçten sun
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(here, "../../dist/client");
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
  }
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  const anyErr = err as { type?: string; status?: number; code?: string; message?: string };
  if (anyErr?.type === "entity.parse.failed") return res.status(400).json({ error: "Geçersiz JSON gövdesi." });
  if (anyErr?.code === "P2002") return res.status(409).json({ error: "Bu kayıt zaten mevcut." });
  if (anyErr?.code === "P2025") return res.status(404).json({ error: "Kayıt bulunamadı." });
  // Hassas veri loglanmaz; yalnızca hata mesajı
  console.error("[api]", anyErr?.message ?? err);
  res.status(500).json({ error: isProd ? "Sunucu hatası." : String(anyErr?.message ?? err) });
});
