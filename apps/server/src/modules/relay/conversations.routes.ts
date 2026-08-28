import type { FastifyInstance } from "fastify";

import { parseBody } from "../../lib/validate.js";
import { isUserOnline } from "./socket.js";
import { createConversationSchema } from "./conversations.schemas.js";
import { createConversation, listConversationsForUser } from "./conversations.service.js";

const CREATE_CONVERSATION_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };

export default async function conversationsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.post(
    "/conversations",
    { config: { rateLimit: CREATE_CONVERSATION_RATE_LIMIT } },
    async (request, reply) => {
      const input = parseBody(createConversationSchema, request.body);
      const conversation = await createConversation(
        fastify.db,
        fastify.r2,
        { type: input.type, creatorId: request.user.id, participantUserIds: input.participantUserIds },
        isUserOnline,
      );
      return reply.code(201).send({ conversation });
    },
  );

  fastify.get("/conversations", async (request, reply) => {
    const items = await listConversationsForUser(fastify.db, fastify.r2, request.user.id, isUserOnline);
    return reply.send({ conversations: items });
  });
}
