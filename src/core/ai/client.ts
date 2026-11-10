import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";

let client: Anthropic | null = null;
let clientKey = "";

/** Anahtar yalnızca bu tarayıcıda saklanır ve doğrudan Anthropic API'sine gönderilir. */
export function anthropic(): Anthropic {
  const key = db().ai.apiKey.trim();
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 120_000 });
    clientKey = key;
  }
  return client;
}

export const MODEL = () => db().ai.model || "claude-opus-5-5";
