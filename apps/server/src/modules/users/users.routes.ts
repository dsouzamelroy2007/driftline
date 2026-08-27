import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { HttpError } from "../../lib/errors.js";
import { createUploadUrl } from "../../lib/r2-client.js";
import { toPublicUser } from "../../lib/serialize.js";
import { parseBody } from "../../lib/validate.js";
import { findUserByEmail, updateAvatar, updateDisplayName } from "./users.service.js";
import { avatarUploadUrlRequestSchema, lookupUserQuerySchema, updateProfileSchema } from "./users.schemas.js";

const AVATAR_UPLOAD_URL_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };

export default async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/me", { preHandler: fastify.authenticate }, async (request, reply) => {
    return reply.send({ user: await toPublicUser(request.user, fastify.r2) });
  });

  fastify.patch("/me", { preHandler: fastify.authenticate }, async (request, reply) => {
    const input = parseBody(updateProfileSchema, request.body);
    let user = await updateDisplayName(fastify.db, request.user.id, input.displayName);
    if (input.avatarUrl !== undefined) {
      user = await updateAvatar(fastify.db, fastify.r2, request.user.id, input.avatarUrl);
    }
    return reply.send({ user: await toPublicUser(user, fastify.r2) });
  });

  fastify.get("/users/lookup", { preHandler: fastify.authenticate }, async (request, reply) => {
    const { email } = parseBody(lookupUserQuerySchema, request.query);
    const user = await findUserByEmail(fastify.db, email);
    if (!user) {
      throw new HttpError(404, "No user with that email");
    }
    return reply.send({ user: await toPublicUser(user, fastify.r2) });
  });

  // Mirrors modules/media/media.routes.ts's upload-url endpoint (docs/ADR/0009), keyed under
  // `avatars/` instead of `attachments/` and validated against the smaller avatar allowlist/cap
  // (docs/ADR/0010). The client PUTs bytes directly to R2, then PATCHes /me with the returned
  // r2Key to actually set it — this endpoint only mints the URL.
  fastify.post(
    "/me/avatar/upload-url",
    { preHandler: fastify.authenticate, config: { rateLimit: AVATAR_UPLOAD_URL_RATE_LIMIT } },
    async (request, reply) => {
      const input = parseBody(avatarUploadUrlRequestSchema, request.body);
      const r2Key = `avatars/${request.user.id}/${randomUUID()}`;
      const uploadUrl = await createUploadUrl(fastify.r2.client, fastify.r2.bucket, r2Key, input.contentType, input.size);
      return reply.send({ uploadUrl, r2Key });
    },
  );
}
