import { getAnthropicClient, CHAT_MODEL } from "./client.js";
import { buildChatSystemPrompt } from "./prompts.js";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/**
 * 壁打ち中のストリーミングチャット (docs/step5-build-plan.md 1章: ノード抽出はバッチ、
 * 会話自体はリアルタイム)。onDelta はテキストの断片が届くたびに呼ばれる。
 * previousTranscriptを渡すと、過去のセッションからの継続として文脈に含める。
 */
export async function streamChatReply(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  previousTranscript?: string,
): Promise<void> {
  const client = getAnthropicClient();

  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: 2048,
    system: buildChatSystemPrompt(previousTranscript),
    messages,
  });

  stream.on("text", (delta) => {
    onDelta(delta);
  });

  await stream.finalMessage();
}
