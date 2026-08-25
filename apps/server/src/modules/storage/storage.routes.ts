import type { FastifyInstance } from "fastify";

import { getStorageSummary } from "./storage.service.js";

export default async function storageRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/me/storage", { preHandler: fastify.authenticate }, async (request, reply) => {
    const summary = await getStorageSummary(fastify.db, request.user.id);
    return reply.send(summary);
  });
}
