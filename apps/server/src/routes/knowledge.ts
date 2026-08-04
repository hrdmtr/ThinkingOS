import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { NodeTypeSchema } from "@thinking-os/shared";
import {
  editNode,
  getNodeById,
  getStats,
  getWeeklyStats,
  listRecentNodes,
  listUnresolvedNodes,
} from "../db/repository.js";

const StatsQuerySchema = z.object({
  sessionId: z.coerce.number().int().positive(),
});

const NodeIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const EditNodeRequestSchema = z.object({
  type: NodeTypeSchema,
  content: z.string().min(1),
});

/**
 * 表示系エンドポイント (thinking-os-plan-v0.2.docx セクション6の「表示」)。
 * 「今日の問い」はAIによる問いかけ生成が必要でまだ未実装（別途extraction/prompt周りと合わせて実装する）。
 * ここでは確定済みデータの単純な読み出しのみを提供する。
 */
export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stats", async (request, reply) => {
    const parsed = StatsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    return getStats(parsed.data.sessionId);
  });

  // 撤退・継続基準（docs/step4-dogfooding.md 4章）の判断材料としての週次命題数推移。
  app.get("/api/stats/weekly", async () => {
    return getWeeklyStats();
  });

  app.get("/api/nodes/recent", async () => {
    return listRecentNodes();
  });

  app.get("/api/nodes/unresolved", async () => {
    return listUnresolvedNodes();
  });

  // 確定済みノードの分類・内容を後から訂正する（ドッグフーディングで発見した課題への対応）。
  // AIの再分類ではなく、人間が自分の過去の確定判断を訂正する操作。編集の痕跡はnode_editsに残す。
  app.patch("/api/nodes/:id", async (request, reply) => {
    const params = NodeIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: params.error.flatten() });
    }
    const body = EditNodeRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }
    if (!getNodeById(params.data.id)) {
      return reply.status(404).send({ error: "node not found" });
    }
    return editNode(params.data.id, body.data.type, body.data.content);
  });
}
