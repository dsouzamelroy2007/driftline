import type { FastifyInstance } from "fastify";

import { HttpError } from "../../lib/errors.js";
import { toPublicDevice } from "../../lib/serialize.js";
import { listDevices, revokeDevice } from "./devices.service.js";

const DEVICE_REVOKE_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };

export default async function devicesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/devices", async (request, reply) => {
    const items = await listDevices(fastify.db, request.user.id);
    return reply.send({ devices: items.map(toPublicDevice) });
  });

  fastify.delete<{ Params: { id: string } }>(
    "/devices/:id",
    { config: { rateLimit: DEVICE_REVOKE_RATE_LIMIT } },
    async (request, reply) => {
      const revoked = await revokeDevice(fastify.db, request.params.id, request.user.id, fastify.r2);
      if (!revoked) {
        throw new HttpError(404, "Device not found");
      }
      return reply.code(204).send();
    },
  );
}
