"use client";

import { requestAvatarUploadUrl } from "./api-client";

// Mirrors apps/server's modules/users/avatar.service.ts allowlist/cap (docs/ADR/0010-profile-pictures.md)
// — a UX nicety, not the actual enforcement boundary; the server validates independently.
const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function validateAvatarFile(file: File): string | null {
  if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
    return "Only JPEG, PNG, WebP, or GIF images are supported.";
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return `Images must be ${MAX_AVATAR_BYTES / (1024 * 1024)}MB or smaller.`;
  }
  return null;
}

// Uploads directly to R2 via a presigned PUT URL, then returns the r2Key for the caller to PATCH
// /me with — unlike a message attachment (lib/attachment-upload.ts), there's no local-store bytes
// to cache: an avatar isn't retention-sensitive content, so it's resolved fresh from the server (an
// R2 key or an external URL) wherever a user is displayed, never cached client-side across sessions.
export async function uploadAvatar(accessToken: string, file: File): Promise<{ r2Key: string }> {
  const { uploadUrl, r2Key } = await requestAvatarUploadUrl(accessToken, { contentType: file.type, size: file.size });

  const putResponse = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!putResponse.ok) {
    throw new Error("Upload failed — check your connection and try again.");
  }

  return { r2Key };
}
