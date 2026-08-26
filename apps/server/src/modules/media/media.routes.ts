import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { createUploadUrl } from "../../lib/r2-client.js";
import { parseBody } from "../../lib/validate.js";
import { uploadUrlRequestSchema } from "./media.schemas.js";

const UPLOAD_URL_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };

export default async function mediaRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("preHandler", fastify.authenticate);

  // Conversation-agnostic on purpose (docs/ADR/0009-media-attachments.md) — the real authorization
  // boundary is message:send's existing isConversationMember check, same as it already is for text.
  // An uploaded-but-never-sent object is a documented, accepted orphan risk, not a security hole.
  fastify.post(
    "/media/upload-url",
    { config: { rateLimit: UPLOAD_URL_RATE_LIMIT } },
    async (request, reply) => {
      const input = parseBody(uploadUrlRequestSchema, request.body);
      const r2Key = `attachments/${request.user.id}/${randomUUID()}`;
      const uploadUrl = await createUploadUrl(fastify.r2.client, fastify.r2.bucket, r2Key, input.contentType, input.size);
      return reply.send({ uploadUrl, r2Key });
    },
  );
}
