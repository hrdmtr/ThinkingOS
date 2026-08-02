import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import { knowledgeRoutes } from "./routes/knowledge.js";
import { sessionRoutes } from "./routes/sessions.js";

const app = Fastify({ logger: true });

await app.register(healthRoutes);
await app.register(knowledgeRoutes);
await app.register(sessionRoutes);

const port = Number(process.env.PORT ?? 3000);

// .env.example / docs/vps-architecture.md の方針どおり、外部公開はCaddyのみが行う。
// アプリ自体はループバックのみでリッスンする。
await app.listen({ port, host: "127.0.0.1" });
