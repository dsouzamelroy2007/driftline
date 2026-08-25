import { z } from "zod";

export const lookupUserQuerySchema = z.object({
  email: z.string().email(),
});

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(80),
});

export type LookupUserQuery = z.infer<typeof lookupUserQuerySchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
