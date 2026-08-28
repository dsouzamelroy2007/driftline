import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { createDbClient } from "@driftline/db";
import Fastify, { type FastifyError } from "fastify";
import { Server as SocketIOServer } from "socket.io";

import { env } from "./env.js";
import { createEmailClient } from "./lib/email.js";
import { HttpError } from "./lib/errors.js";
import { checkHealth } from "./lib/health.js";
import { logRetentionViolation } from "./lib/metrics.js";
import { createR2Client } from "./lib/r2-client.js";
import { createRedisClient } from "./lib/redis.js";
import { captureException, captureRetentionViolation, flushSentry, initSentry } from "./lib/sentry.js";
import authRoutes from "./modules/auth/auth.routes.js";
import magicLinkRoutes from "./modules/auth/magic-link.routes.js";
import oauthRoutes from "./modules/auth/oauth/oauth.routes.js";
import deviceLinkRoutes from "./modules/devices/device-link.routes.js";
import devicesRoutes from "./modules/devices/devices.routes.js";
import discoveryRoutes from "./modules/discovery/discovery.routes.js";
import { startDiscoveryHeartbeat } from "./modules/discovery/discovery.service.js";
import mediaRoutes from "./modules/media/media.routes.js";
import conversationsRoutes from "./modules/relay/conversations.routes.js";
import { sweepDormantDevices } from "./modules/relay/dormancy.js";
import { checkRetentionCompliance } from "./modules/relay/retention-monitor.js";
import { registerSocketHandlers } from "./modules/relay/socket.js";
import { sweepExpiredEnvelopes } from "./modules/relay/sweeper.js";
import storageRoutes from "./modules/storage/storage.routes.js";
import usersRoutes from "./modules/users/users.routes.js";
import appContext from "./plugins/app-context.js";
import authPlugin from "./plugins/auth-plugin.js";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

initSentry(env.SENTRY_DSN, env.NODE_ENV);

const db = createDbClient(env.DATABASE_URL);
const redis = createRedisClient(env.REDIS_URL);
const email = createEmailClient(env.RESEND_API_KEY);
const r2 = { client: createR2Client(env), bucket: env.R2_BUCKET_NAME };

const app = Fastify({ logger: true });

// Phase 8 hardening: an uncaught error or rejected promise anywhere outside a request handler
// (e.g. in the sweeper's setInterval callback, or a Socket.IO event handler) previously had no
// listener at all — Node's default behavior is to crash the process immediately with no structured
// log line. Logging first, then exiting, means the platform's restart-on-crash still kicks in, but
// the failure is actually visible in the logs instead of a silent restart.
process.on("uncaughtException", (error) => {
  app.log.error(error, "uncaughtException");
  captureException(error);
  void flushSentry(2000).finally(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  app.log.error(reason, "unhandledRejection");
  captureException(reason);
  void flushSentry(2000).finally(() => process.exit(1));
});

app.setErrorHandler((error: FastifyError, request, reply) => {
  // Not just HttpError: Fastify's own plugins (rate-limit, schema validation)
  // throw errors that already carry the right statusCode (e.g. 429) — respect
  // it generically rather than masking every non-HttpError as a 500.
  const statusCode = error instanceof HttpError ? error.statusCode : (error.statusCode ?? 500);
  if (statusCode >= 500) {
    request.log.error(error);
    captureException(error);
    reply.code(500).send({ error: "Internal server error" });
    return;
  }
  reply.code(statusCode).send({ error: error.message });
});

await app.register(appContext, { db, redis, email, env, r2 });
await app.register(cors, { origin: env.WEB_ORIGIN });
await app.register(rateLimit, { global: false, redis });
await app.register(authPlugin);

// Actually checks the two dependencies this process can't run without, rather than a bare 200 —
// Render's own health check couldn't previously distinguish "up but can't reach Postgres/Redis"
// from genuinely healthy, so a stuck instance never got auto-restarted (Phase 8 hardening).
app.get("/health", async (_request, reply) => {
  const result = await checkHealth(db, redis);
  return reply.code(result.status === "ok" ? 200 : 503).send(result);
});
await app.register(authRoutes);
await app.register(magicLinkRoutes);
await app.register(oauthRoutes);
await app.register(usersRoutes);
await app.register(devicesRoutes);
await app.register(deviceLinkRoutes);
await app.register(discoveryRoutes);
await app.register(conversationsRoutes);
await app.register(storageRoutes);
await app.register(mediaRoutes);

await app.listen({ port: env.PORT, host: "0.0.0.0" });

const io = new SocketIOServer(app.server, {
  cors: { origin: env.WEB_ORIGIN },
});

registerSocketHandlers(io, { db, env, redis, r2 });

startDiscoveryHeartbeat(redis, randomUUID(), env.DISCOVERY_HOST);

// In-process interval sweeps, not a separate infra/scripts job — zero extra cost on a $0-budget
// deployment. Revisit only if this ever needs to move out-of-process (Phase 8/9).
let sweepRunning = false;
setInterval(() => {
  if (sweepRunning) return;
  sweepRunning = true;
  void Promise.all([sweepExpiredEnvelopes(db, r2), sweepDormantDevices(db, env.DEVICE_DORMANCY_DAYS)])
    .then(async ([envelopeResult, dormantCount]) => {
      if (envelopeResult.purgedCount > 0 || dormantCount > 0) {
        app.log.info(
          { purgedEnvelopes: envelopeResult.purgedCount, durationMs: envelopeResult.durationMs, dormantCount },
          "retention sweep",
        );
      }

      // docs/RETENTION.md §7's last checklist item: if the sweep above still leaves an envelope
      // older than the retention window, the sweeper itself is broken — alert, don't just log.
      const compliance = await checkRetentionCompliance(db, env.RETENTION_WINDOW_DAYS);
      if (!compliance.compliant && compliance.oldestEnvelopeAgeMs !== null) {
        app.log.error({ oldestEnvelopeAgeMs: compliance.oldestEnvelopeAgeMs }, "retention violation");
        logRetentionViolation(compliance.oldestEnvelopeAgeMs, env.RETENTION_WINDOW_DAYS);
        captureRetentionViolation(compliance.oldestEnvelopeAgeMs, env.RETENTION_WINDOW_DAYS);
      }
    })
    .catch((error: unknown) => app.log.error(error, "retention sweep failed"))
    .finally(() => {
      sweepRunning = false;
    });
}, SWEEP_INTERVAL_MS);
