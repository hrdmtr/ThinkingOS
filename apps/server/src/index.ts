import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { healthRoutes } from "./routes/health.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { sessionRoutes } from "./routes/sessions.js";

const app = Fastify({ logger: true });

await app.register(healthRoutes);
await app.register(knowledgeRoutes);
await app.register(sessionRoutes);

// フロントエンド(apps/web)のビルド成果物を配信する。Caddyは単一オリジンとして
// このアプリにリバースプロキシするだけなので、静的ファイル配信もアプリ側の責務になる
// (docs/vps-architecture.md 3章: reverse_proxy 127.0.0.1:3000)。
const here = path.dirname(fileURLToPath(import.meta.url));
const webDistDir = path.resolve(here, "../../web/dist");

await app.register(fastifyStatic, {
  root: webDistDir,
});

// SPAなのでAPI以外のGETリクエストはすべてindex.htmlを返す
// (このアプリはURLベースのクライアントサイドルーティングを使っていないが、
// ブラウザの直接リロード等でも壊れないようにしておく)。
app.setNotFoundHandler((request, reply) => {
  if (request.method === "GET" && !request.url.startsWith("/api/")) {
    return reply.sendFile("index.html", webDistDir);
  }
  return reply.status(404).send({ error: "Not Found" });
});

const port = Number(process.env.PORT ?? 3000);

// .env.example / docs/vps-architecture.md の方針どおり、外部公開はCaddyのみが行う。
// アプリ自体はループバックのみでリッスンする。
await app.listen({ port, host: "127.0.0.1" });
