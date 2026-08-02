import { NODE_TYPES, type ExtractionResult } from "@thinking-os/shared";
import { getAnthropicClient, CHAT_MODEL } from "./client.js";
import { EXTRACTION_SYSTEM_PROMPT } from "./prompts.js";
import type Anthropic from "@anthropic-ai/sdk";

const EXTRACTION_TOOL_NAME = "record_extraction";

const nodeCandidateJsonSchema = {
  type: "object" as const,
  properties: {
    tempId: { type: "string" as const, description: "この候補内で一意な一時ID（例: n1, n2）" },
    type: { type: "string" as const, enum: NODE_TYPES as unknown as string[] },
    content: { type: "string" as const },
  },
  required: ["tempId", "type", "content"],
};

const edgeCandidateJsonSchema = {
  type: "object" as const,
  properties: {
    tempId: { type: "string" as const, description: "この候補内で一意な一時ID（例: e1, e2）" },
    sourceRef: {
      description: "関係の起点。新規ノード候補ならtempId、既存の確定済みノードなら数値id",
    },
    targetRef: {
      description: "関係の終点。新規ノード候補ならtempId、既存の確定済みノードなら数値id",
    },
    labelSuggestion: { type: "string" as const, description: "関係ラベルの案（例: 対比、帰結、想起、または自由記述）" },
    rationale: { type: "string" as const, description: "なぜこの関係だと考えたかの簡単な理由" },
  },
  required: ["tempId", "sourceRef", "targetRef", "labelSuggestion"],
};

/**
 * セッション終了時のバッチ抽出 (docs/step5-build-plan.md 1章)。
 * 戻り値はあくまで「提案」であり、この関数自体はDBに一切書き込まない。
 */
export async function extractFromTranscript(
  sessionId: number,
  transcript: string,
  existingNodesSummary: string,
): Promise<ExtractionResult> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: CHAT_MODEL,
    max_tokens: 4096,
    system: EXTRACTION_SYSTEM_PROMPT,
    tools: [
      {
        name: EXTRACTION_TOOL_NAME,
        description:
          "会話ログから抽出したノード候補・関係候補を構造化データとして記録する。",
        input_schema: {
          type: "object",
          properties: {
            newNodes: { type: "array", items: nodeCandidateJsonSchema },
            edgeCandidates: { type: "array", items: edgeCandidateJsonSchema },
          },
          required: ["newNodes", "edgeCandidates"],
        },
      },
    ],
    tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          "## 既存の確定済みノード（抜粋・関連候補の参照用）",
          existingNodesSummary || "（まだ確定済みのノードはありません）",
          "",
          "## 今回のセッションの会話ログ全文",
          transcript,
        ].join("\n"),
      },
    ],
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === EXTRACTION_TOOL_NAME,
  );

  if (!toolUseBlock) {
    throw new Error("AIの抽出応答にtool_useブロックが含まれていませんでした");
  }

  const raw = toolUseBlock.input as {
    newNodes?: unknown[];
    edgeCandidates?: unknown[];
  };

  return {
    sessionId,
    newNodes: (raw.newNodes ?? []) as ExtractionResult["newNodes"],
    edgeCandidates: (raw.edgeCandidates ?? []) as ExtractionResult["edgeCandidates"],
  };
}
