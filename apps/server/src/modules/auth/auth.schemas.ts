import { z } from "zod";

export const deviceInfoSchema = z.object({
  deviceId: z.string().uuid().optional(),
  platform: z.enum(["web", "ios", "android"]),
  publicKey: z.string().optional(),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(80),
  device: deviceInfoSchema,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device: deviceInfoSchema,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type DeviceInfo = z.infer<typeof deviceInfoSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
