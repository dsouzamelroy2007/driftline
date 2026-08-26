"use client";

import { requestUploadUrl } from "./api-client";

// Mirrors apps/server's modules/media/media.service.ts allowlist/cap — this is a UX nicety (fail
// fast, before even asking the server for an upload URL), not the actual enforcement boundary; the
// server validates independently (docs/ADR/0009-media-attachments.md).
const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function validateAttachmentFile(file: File): string | null {
  if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
    return "Only JPEG, PNG, WebP, or GIF images are supported.";
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `Images must be ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB or smaller.`;
  }
  return null;
}

// Same byte-to-base64 primitive already used in packages/backup and packages/sync-engine.
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface UploadedAttachment {
  contentType: string;
  /** The small { r2Key, size } descriptor, base64-encoded — this is the actual message `payload`
   * sent to the server (docs/ADR/0009-media-attachments.md), never the image bytes themselves. */
  descriptorPayload: string;
  /** The raw file bytes, base64-encoded — for the local optimistic outbox row only, never sent to
   * the server (it already has the bytes, via the direct-to-R2 upload below). */
  attachmentPayload: string;
}

// Uploads directly to R2 via a presigned PUT URL — the file bytes never pass through this app's own
// server (docs/ADR/0009-media-attachments.md).
export async function uploadAttachment(accessToken: string, file: File): Promise<UploadedAttachment> {
  const { uploadUrl, r2Key } = await requestUploadUrl(accessToken, { contentType: file.type, size: file.size });

  const putResponse = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!putResponse.ok) {
    throw new Error("Upload failed — check your connection and try again.");
  }

  const attachmentPayload = await fileToBase64(file);
  const descriptorPayload = btoa(JSON.stringify({ r2Key, size: file.size }));

  return { contentType: file.type, descriptorPayload, attachmentPayload };
}
