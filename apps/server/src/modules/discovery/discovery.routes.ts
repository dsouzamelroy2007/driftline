import type { FastifyInstance } from "fastify";

import { getAvailableHost } from "./discovery.service.js";

export default async function discoveryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/discovery", async (_request, reply) => {
    const host = await getAvailableHost(fastify.redis);
    if (!host) {
      return reply.code(503).send({ error: "No chat server currently available" });
    }
    return reply.send({ host });
  });
}
