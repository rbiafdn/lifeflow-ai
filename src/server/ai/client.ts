import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2, timeout: 90_000 });
  }
  return client;
}

export const MODEL = () => config.anthropicModel;
