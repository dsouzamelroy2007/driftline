import type { Device, User } from "@driftline/db";
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";

import { resolvePrincipal } from "../lib/principal.js";
import { verifyAccessToken } from "../lib/tokens.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: User;
    device: Device;
  }
}

export default fp(async (fastify) => {
  fastify.decorate(
    "authenticate",
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Missing bearer token" });
      }

      try {
        const claims = await verifyAccessToken(header.slice("Bearer ".length), fastify.env.JWT_SECRET);
        const principal = await resolvePrincipal(fastify.db, claims);
        if (!principal) {
          return reply.code(401).send({ error: "Device revoked or not found" });
        }

        request.user = principal.user;
        request.device = principal.device;
      } catch {
        return reply.code(401).send({ error: "Invalid or expired access token" });
      }
    },
  );
});
