import "dotenv/config";

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Eksik ortam değişkeni: ${name}`);
  return v;
}

export const isProd = process.env.NODE_ENV === "production" || !!process.env.VERCEL;

export const config = {
  port: Number(process.env.PORT ?? 5200),
  jwtSecret: req("JWT_SECRET", isProd ? undefined : "lifeflow-dev-secret"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  aiDailyLimit: Number(process.env.AI_DAILY_LIMIT ?? 60),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "",
  cookieName: "lifeflow_token",
};

export const aiEnabled = () => config.anthropicApiKey.length > 0;
