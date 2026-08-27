import { z } from "zod";

import { AVATAR_CONTENT_TYPES, MAX_AVATAR_BYTES } from "./avatar.service.js";

export const lookupUserQuerySchema = z.object({
  email: z.string().email(),
});

// avatarUrl is the r2Key returned by POST /me/avatar/upload-url, or null to remove the current
// avatar — never a client-supplied external URL (that would let a client point avatarUrl at
// anything, bypassing the upload flow entirely). displayName stays required: this endpoint predates
// avatars and every existing caller (Settings > Edit profile) always sends it.
export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(80),
  avatarUrl: z.string().min(1).max(2048).nullable().optional(),
});

export const avatarUploadUrlRequestSchema = z.object({
  contentType: z.enum(AVATAR_CONTENT_TYPES),
  size: z
    .number()
    .int()
    .positive()
    .max(MAX_AVATAR_BYTES, `Image must be ${MAX_AVATAR_BYTES / (1024 * 1024)}MB or smaller`),
});

export type LookupUserQuery = z.infer<typeof lookupUserQuerySchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type AvatarUploadUrlRequest = z.infer<typeof avatarUploadUrlRequestSchema>;
