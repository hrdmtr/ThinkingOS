import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set (see .env.example)");
  }
  client = new Anthropic({ apiKey });
  return client;
}

// 2026-08時点の最新Sonnetモデル。将来のモデル更新時はここだけ変更すればよい。
export const CHAT_MODEL = "claude-sonnet-5";
