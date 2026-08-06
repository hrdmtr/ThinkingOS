import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SubmitReviewRequestSchema } from "@thinking-os/shared";
import { streamChatReply, type ChatMessage } from "../ai/chat.js";
import { extractFromTranscript } from "../ai/extraction.js";
import {
  createSession,
  endSession,
  getPreviousTranscript,
  insertConfirmedEdge,
  insertConfirmedNode,
  listRecentNodes,
  listRecentSessions,
} from "../db/repository.js";

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
});

const EndSessionRequestSchema = z.object({
  transcript: z.string().min(1),
});

const CreateSessionRequestSchema = z.object({
  continueFromSessionId: z.number().int().positive().optional(),
});

function summarizeExistingNodes(): string {
  const nodes = listRecentNodes(30);
  if (nodes.length === 0) return "";
  return nodes
    .map((node) => `- [id:${node.id}] (${node.type}) ${node.content}`)
    .join("\n");
}

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/sessions", async (request) => {
    const body = CreateSessionRequestSchema.parse(request.body ?? {});
    const sessionId = createSession(body.continueFromSessionId);
    return { sessionId };
  });

  // 「前回の話題をもっと深掘りしたい」というドッグフーディングでのフィードバックへの対応。
  // 継続元として選べる、終了済みセッションの一覧。
  // 他の一覧系エンドポイント（/api/nodes/recent等）と合わせ、配列を直接返す。
  app.get("/api/sessions/recent", async () => {
    return listRecentSessions();
  });

  app.post("/api/sessions/:id/chat", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(
      request.params,
    );
    const body = ChatRequestSchema.parse(request.body);
    const previousTranscript = getPreviousTranscript(params.id);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    });

    try {
      await streamChatReply(
        body.messages as ChatMessage[],
        (text) => {
          reply.raw.write(text);
        },
        previousTranscript,
      );
    } catch (err) {
      app.log.error({ err, sessionId: params.id }, "chat streaming failed");
      reply.raw.write("\n[エラー: 応答の取得に失敗しました]");
    } finally {
      reply.raw.end();
    }
  });

  // セッション終了→バッチ抽出 (docs/step5-build-plan.md 1章・3章)。
  // ここで返るのはあくまで提案であり、DBには何も保存しない。
  app.post("/api/sessions/:id/end", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(
      request.params,
    );
    const body = EndSessionRequestSchema.parse(request.body);

    endSession(params.id, body.transcript);

    try {
      const result = await extractFromTranscript(
        params.id,
        body.transcript,
        summarizeExistingNodes(),
      );
      return result;
    } catch (err) {
      app.log.error({ err, sessionId: params.id }, "extraction failed");
      return reply.status(502).send({
        error: "抽出処理に失敗しました。セッション自体は保存されています。",
      });
    }
  });

  // 統合レビュー画面での確定/修正/却下 (docs/step5-build-plan.md 3章)。
  // 却下・未確定のものは何も保存しない。ここを通ったものだけが実データになる。
  app.post("/api/sessions/:id/review", async (request, reply) => {
    const params = z.object({ id: z.coerce.number().int().positive() }).parse(
      request.params,
    );
    // AIの提案（tagSuggestions等、自由記述の配列を含む）をほぼそのまま含んだ内容が
    // フロントエンド経由で送られてくるため、.parse()の例外を素通りさせず、
    // 検証失敗時にユーザーに分かる400を返す（AIの出力揺れでレビュー確定全体が
    // 500で落ちることを防ぐ）。
    const parsedBody = SubmitReviewRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }
    const body = parsedBody.data;

    if (body.sessionId !== params.id) {
      return reply.status(400).send({ error: "sessionIdがURLと一致しません" });
    }

    // tempId -> 新規に確定・発行されたDB上のノードid
    const confirmedNodeIds = new Map<string, number>();

    for (const nodeReview of body.nodeReviews) {
      if (nodeReview.decision === "reject") continue;

      // "confirm"の場合もAI提案どおりの値をフロントエンドが含めて送ってくる想定
      // （このAPIは提案内容をサーバー側で覚えていないステートレス設計のため）。
      const type = nodeReview.type;
      const content = nodeReview.content;
      if (!type || !content) {
        return reply.status(400).send({
          error: `nodeReview(tempId=${nodeReview.tempId})にtype/contentが必要です`,
        });
      }
      const newId = insertConfirmedNode(type, content, params.id, nodeReview.tags ?? []);
      confirmedNodeIds.set(nodeReview.tempId, newId);
    }

    const confirmedEdgeIds = new Map<string, number>();

    function resolveNodeRef(ref: string | number | undefined): number | undefined {
      if (ref === undefined) return undefined;
      if (typeof ref === "number") return ref; // 既存の確定済みノードid
      return confirmedNodeIds.get(ref); // 同じレビューでいま確定した新規ノードのtempId
    }

    for (const edgeReview of body.edgeReviews) {
      if (edgeReview.decision === "reject") continue;

      const label = edgeReview.label;
      const sourceNodeId = resolveNodeRef(edgeReview.sourceRef);
      const targetNodeId = resolveNodeRef(edgeReview.targetRef);

      if (!label || sourceNodeId === undefined || targetNodeId === undefined) {
        return reply.status(400).send({
          error: `edgeReview(tempId=${edgeReview.tempId})のlabel/sourceRef/targetRefを解決できませんでした（参照先のノードが却下されている可能性があります）`,
        });
      }

      const newEdgeId = insertConfirmedEdge(sourceNodeId, targetNodeId, label);
      confirmedEdgeIds.set(edgeReview.tempId, newEdgeId);
    }

    return {
      confirmedNodeIds: Object.fromEntries(confirmedNodeIds),
      confirmedEdgeIds: Object.fromEntries(confirmedEdgeIds),
    };
  });
}
