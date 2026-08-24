import { devices, users, type Device, type User } from "@driftline/db";
import { and, eq, isNull } from "drizzle-orm";
import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";

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

        // JWTs are stateless by default, but device revocation must take effect
        // immediately (docs/RETENTION.md §5), not wait for the access token to
        // expire — so every authenticated request re-checks revocation state.
        const [device] = await fastify.db
          .select()
          .from(devices)
          .where(and(eq(devices.id, claims.deviceId), isNull(devices.revokedAt)))
          .limit(1);

        if (!device) {
          return reply.code(401).send({ error: "Device revoked or not found" });
        }

        const [user] = await fastify.db.select().from(users).where(eq(users.id, claims.userId)).limit(1);
        if (!user) {
          return reply.code(401).send({ error: "User not found" });
        }

        request.user = user;
        request.device = device;
      } catch {
        return reply.code(401).send({ error: "Invalid or expired access token" });
      }
    },
  );
});
