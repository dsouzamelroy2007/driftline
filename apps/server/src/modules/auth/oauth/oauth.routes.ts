import { randomBytes } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { parseBody } from "../../../lib/validate.js";
import { issueTokenPair, upsertDevice } from "../auth.service.js";
import { deviceInfoSchema, type DeviceInfo } from "../auth.schemas.js";
import { buildAuthorizeUrl, exchangeCodeForToken, fetchGithubIdentity, findOrCreateOAuthUser } from "./github.service.js";

const OAUTH_STATE_TTL_SECONDS = 600;
const callbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1) });

interface StoredOAuthState {
  device: DeviceInfo;
}

function stateKey(state: string): string {
  return `oauth-state:${state}`;
}

export default async function oauthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/auth/oauth/github/start", async (request, reply) => {
    const device = parseBody(deviceInfoSchema, request.query);
    const state = randomBytes(24).toString("base64url");
    const stored: StoredOAuthState = { device };
    await fastify.redis.set(stateKey(state), JSON.stringify(stored), "EX", OAUTH_STATE_TTL_SECONDS);
    return reply.redirect(buildAuthorizeUrl(state, fastify.env));
  });

  fastify.get("/auth/oauth/github/callback", async (request, reply) => {
    const query = callbackQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.redirect(`${fastify.env.WEB_ORIGIN}/auth/callback?error=invalid_request`);
    }

    const raw = await fastify.redis.getdel(stateKey(query.data.state));
    if (!raw) {
      return reply.redirect(`${fastify.env.WEB_ORIGIN}/auth/callback?error=invalid_state`);
    }
    const { device } = JSON.parse(raw) as StoredOAuthState;

    const accessToken = await exchangeCodeForToken(query.data.code, fastify.env);
    const identity = await fetchGithubIdentity(accessToken);
    const user = await findOrCreateOAuthUser(fastify.db, identity);
    const deviceRow = await upsertDevice(fastify.db, user.id, device);
    const tokens = await issueTokenPair(fastify.db, user.id, deviceRow.id, fastify.env);

    const redirectUrl = new URL(`${fastify.env.WEB_ORIGIN}/auth/callback`);
    redirectUrl.hash = `accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`;
    return reply.redirect(redirectUrl.toString());
  });
}
