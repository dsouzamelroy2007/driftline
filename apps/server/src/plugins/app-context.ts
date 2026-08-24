import type { Db } from "@driftline/db";
import fp from "fastify-plugin";
import type { Redis } from "ioredis";
import type { Resend } from "resend";

import type { env as Env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    redis: Redis;
    email: Resend;
    env: typeof Env;
  }
}

export interface AppContext {
  db: Db;
  redis: Redis;
  email: Resend;
  env: typeof Env;
}

export default fp(async (fastify, opts: AppContext) => {
  fastify.decorate("db", opts.db);
  fastify.decorate("redis", opts.redis);
  fastify.decorate("email", opts.email);
  fastify.decorate("env", opts.env);
});
