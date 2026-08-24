import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  WEB_ORIGIN: z.string().min(1).default("http://localhost:3000"),
  DISCOVERY_HOST: z.string().min(1).default("http://localhost:4000"),
  SERVER_PUBLIC_URL: z.string().min(1).default("http://localhost:4000"),
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  RESEND_FROM_EMAIL: z.string().min(1).default("Driftline <onboarding@resend.dev>"),
  GITHUB_CLIENT_ID: z.string().min(1, "GITHUB_CLIENT_ID is required"),
  GITHUB_CLIENT_SECRET: z.string().min(1, "GITHUB_CLIENT_SECRET is required"),
  RETENTION_WINDOW_DAYS: z.coerce.number().int().positive().default(30),
  DEVICE_DORMANCY_DAYS: z.coerce.number().int().positive().default(30),
});

export const env = envSchema.parse(process.env);
