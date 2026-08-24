import type { Db } from "@driftline/db";
import fp from "fastify-plugin";
import type { Redis } from "ioredis";

import type { env as Env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    redis: Redis;
    env: typeof Env;
  }
}

export interface AppContext {
  db: Db;
  redis: Redis;
  env: typeof Env;
}

export default fp(async (fastify, opts: AppContext) => {
  fastify.decorate("db", opts.db);
  fastify.decorate("redis", opts.redis);
  fastify.decorate("env", opts.env);
});
