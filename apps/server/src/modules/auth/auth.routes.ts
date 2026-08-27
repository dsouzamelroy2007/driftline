import type { FastifyInstance } from "fastify";

import { toPublicDevice, toPublicUser } from "../../lib/serialize.js";
import { parseBody } from "../../lib/validate.js";
import { loginUser, logoutDevice, refreshTokens, registerUser } from "./auth.service.js";
import { loginSchema, refreshSchema, registerSchema } from "./auth.schemas.js";

const AUTH_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    "/auth/register",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const input = parseBody(registerSchema, request.body);
      const { user, device, ...tokens } = await registerUser(fastify.db, input, fastify.env);
      return reply
        .code(201)
        .send({ user: await toPublicUser(user, fastify.r2), device: toPublicDevice(device), ...tokens });
    },
  );

  fastify.post(
    "/auth/login",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const input = parseBody(loginSchema, request.body);
      const { user, device, ...tokens } = await loginUser(fastify.db, input, fastify.env);
      return reply.send({ user: await toPublicUser(user, fastify.r2), device: toPublicDevice(device), ...tokens });
    },
  );

  fastify.post("/auth/refresh", async (request, reply) => {
    const { refreshToken } = parseBody(refreshSchema, request.body);
    const result = await refreshTokens(fastify.db, refreshToken, fastify.env);
    return reply.send(result);
  });

  fastify.post(
    "/auth/logout",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      await logoutDevice(fastify.db, request.device.id);
      return reply.code(204).send();
    },
  );
}
