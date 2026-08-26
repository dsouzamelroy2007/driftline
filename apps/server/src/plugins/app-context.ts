import type { Db } from "@driftline/db";
import type { S3Client } from "@aws-sdk/client-s3";
import fp from "fastify-plugin";
import type { Redis } from "ioredis";
import type { Resend } from "resend";

import type { env as Env } from "../env.js";

export interface R2Context {
  client: S3Client;
  bucket: string;
}

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    redis: Redis;
    email: Resend;
    env: typeof Env;
    r2: R2Context;
  }
}

export interface AppContext {
  db: Db;
  redis: Redis;
  email: Resend;
  env: typeof Env;
  r2: R2Context;
}

export default fp(async (fastify, opts: AppContext) => {
  fastify.decorate("db", opts.db);
  fastify.decorate("redis", opts.redis);
  fastify.decorate("email", opts.email);
  fastify.decorate("env", opts.env);
  fastify.decorate("r2", opts.r2);
});
