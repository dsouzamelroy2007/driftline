import { z } from "zod";

import { deviceInfoSchema } from "./auth.schemas.js";

export const magicLinkRequestSchema = z.object({
  email: z.string().email(),
  device: deviceInfoSchema,
});

export const magicLinkVerifySchema = z.object({
  token: z.string().min(1),
});
