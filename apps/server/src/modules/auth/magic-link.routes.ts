import type { FastifyInstance } from "fastify";

import { toPublicDevice, toPublicUser } from "../../lib/serialize.js";
import { parseBody } from "../../lib/validate.js";
import { magicLinkRequestSchema, magicLinkVerifySchema } from "./magic-link.schemas.js";
import { requestMagicLink, verifyMagicLink } from "./magic-link.service.js";

const MAGIC_LINK_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

export default async function magicLinkRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/auth/magic-link/request",
    { config: { rateLimit: MAGIC_LINK_RATE_LIMIT } },
    async (request, reply) => {
      const input = parseBody(magicLinkRequestSchema, request.body);
      await requestMagicLink(
        fastify.db,
        fastify.redis,
        fastify.email,
        input.email,
        input.device,
        fastify.env,
      );
      return reply.code(202).send();
    },
  );

  fastify.post("/auth/magic-link/verify", async (request, reply) => {
    const { token } = parseBody(magicLinkVerifySchema, request.body);
    const { user, device, ...tokens } = await verifyMagicLink(
      fastify.db,
      fastify.redis,
      token,
      fastify.env,
    );
    return reply.send({ user: await toPublicUser(user, fastify.r2), device: toPublicDevice(device), ...tokens });
  });
}
