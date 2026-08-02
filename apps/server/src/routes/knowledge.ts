import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getStats,
  listRecentNodes,
  listUnresolvedNodes,
} from "../db/repository.js";

const StatsQuerySchema = z.object({
  sessionId: z.coerce.number().int().positive(),
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

  app.get("/api/nodes/recent", async () => {
    return listRecentNodes();
  });

  app.get("/api/nodes/unresolved", async () => {
    return listUnresolvedNodes();
  });
}
