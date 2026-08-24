import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createDbClient } from "@driftline/db";
import Fastify, { type FastifyError } from "fastify";
import { Server as SocketIOServer } from "socket.io";

import { env } from "./env.js";
import { createEmailClient } from "./lib/email.js";
import { HttpError } from "./lib/errors.js";
import { createRedisClient } from "./lib/redis.js";
import authRoutes from "./modules/auth/auth.routes.js";
import magicLinkRoutes from "./modules/auth/magic-link.routes.js";
import oauthRoutes from "./modules/auth/oauth/oauth.routes.js";
import devicesRoutes from "./modules/devices/devices.routes.js";
import discoveryRoutes from "./modules/discovery/discovery.routes.js";
import { startDiscoveryHeartbeat } from "./modules/discovery/discovery.service.js";
import usersRoutes from "./modules/users/users.routes.js";
import appContext from "./plugins/app-context.js";
import authPlugin from "./plugins/auth-plugin.js";

const db = createDbClient(env.DATABASE_URL);
const redis = createRedisClient(env.REDIS_URL);
const email = createEmailClient(env.RESEND_API_KEY);

const app = Fastify({ logger: true });

app.setErrorHandler((error: FastifyError, request, reply) => {
  // Not just HttpError: Fastify's own plugins (rate-limit, schema validation)
  // throw errors that already carry the right statusCode (e.g. 429) — respect
  // it generically rather than masking every non-HttpError as a 500.
  const statusCode = error instanceof HttpError ? error.statusCode : (error.statusCode ?? 500);
  if (statusCode >= 500) {
    request.log.error(error);
    reply.code(500).send({ error: "Internal server error" });
    return;
  }
  reply.code(statusCode).send({ error: error.message });
});

await app.register(appContext, { db, redis, email, env });
await app.register(cors, { origin: env.WEB_ORIGIN });
await app.register(rateLimit, { global: false, redis });
await app.register(authPlugin);

app.get("/health", async () => ({ status: "ok" }));
await app.register(authRoutes);
await app.register(magicLinkRoutes);
await app.register(oauthRoutes);
await app.register(usersRoutes);
await app.register(devicesRoutes);
await app.register(discoveryRoutes);

await app.listen({ port: env.PORT, host: "0.0.0.0" });

const io = new SocketIOServer(app.server, {
  cors: { origin: env.WEB_ORIGIN },
});

io.on("connection", (socket) => {
  socket.on("ping", () => socket.emit("pong"));
});

startDiscoveryHeartbeat(redis, randomUUID(), env.DISCOVERY_HOST);
