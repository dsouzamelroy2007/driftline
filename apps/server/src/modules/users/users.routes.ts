import type { FastifyInstance } from "fastify";

import { HttpError } from "../../lib/errors.js";
import { toPublicUser } from "../../lib/serialize.js";
import { parseBody } from "../../lib/validate.js";
import { findUserByEmail, updateDisplayName } from "./users.service.js";
import { lookupUserQuerySchema, updateProfileSchema } from "./users.schemas.js";

export default async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/me", { preHandler: fastify.authenticate }, async (request, reply) => {
    return reply.send({ user: toPublicUser(request.user) });
  });

  fastify.patch("/me", { preHandler: fastify.authenticate }, async (request, reply) => {
    const input = parseBody(updateProfileSchema, request.body);
    const user = await updateDisplayName(fastify.db, request.user.id, input.displayName);
    return reply.send({ user: toPublicUser(user) });
  });

  fastify.get("/users/lookup", { preHandler: fastify.authenticate }, async (request, reply) => {
    const { email } = parseBody(lookupUserQuerySchema, request.query);
    const user = await findUserByEmail(fastify.db, email);
    if (!user) {
      throw new HttpError(404, "No user with that email");
    }
    return reply.send({ user: toPublicUser(user) });
  });
}
