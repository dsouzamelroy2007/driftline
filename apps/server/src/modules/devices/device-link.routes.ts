import type { FastifyInstance } from "fastify";

import { createPairingSession } from "./device-link.service.js";

const DEVICE_LINK_START_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

export default async function deviceLinkRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("preHandler", fastify.authenticate);

  // The new/empty device (the "host" — docs/ADR/0008-device-linking-protocol.md) calls this once
  // it's logged in, to mint a pairing code to show as a QR/manual-entry code. The device that
  // already has history (the "source") joins the resulting session over the socket connection —
  // see modules/relay/socket.ts's device-link:join handler.
  fastify.post(
    "/devices/link/start",
    { config: { rateLimit: DEVICE_LINK_START_RATE_LIMIT } },
    async (request, reply) => {
      const { code, expiresAt } = await createPairingSession(fastify.redis, request.user.id, request.device.id);
      return reply.send({ code, expiresAt: expiresAt.toISOString() });
    },
  );
}
