import { getAnthropicClient, CHAT_MODEL } from "./client.js";
import { CHAT_SYSTEM_PROMPT } from "./prompts.js";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * 壁打ち中のストリーミングチャット (docs/step5-build-plan.md 1章: ノード抽出はバッチ、
 * 会話自体はリアルタイム)。onDelta はテキストの断片が届くたびに呼ばれる。
 */
export async function streamChatReply(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
): Promise<void> {
  const client = getAnthropicClient();

  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: 2048,
    system: CHAT_SYSTEM_PROMPT,
    messages,
  });

  stream.on("text", (delta) => {
    onDelta(delta);
  });

  await stream.finalMessage();
}
