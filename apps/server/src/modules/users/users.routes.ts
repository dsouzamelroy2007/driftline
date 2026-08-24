import type { FastifyInstance } from "fastify";

import { toPublicUser } from "../../lib/serialize.js";

export default async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/me", { preHandler: fastify.authenticate }, async (request, reply) => {
    return reply.send({ user: toPublicUser(request.user) });
  });
}
