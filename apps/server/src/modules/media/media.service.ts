import type { S3Client } from "@aws-sdk/client-s3";

import { deleteR2Object } from "../../lib/r2-client.js";
import { logMediaCleanupFailed, logMediaObjectPurged } from "../../lib/metrics.js";

// docs/ADR/0009-media-attachments.md: an attachment is a specially-interpreted envelope payload,
// not a new entity — envelopes.payload is already opaque base64 the server never otherwise parses
// (docs/RETENTION.md §1). A media message's payload decodes to base64 JSON: { r2Key, size }.
export const MEDIA_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface MediaDescriptor {
  r2Key: string;
  size: number;
}

export function isMediaContentType(contentType: string): contentType is MediaContentType {
  return (MEDIA_CONTENT_TYPES as readonly string[]).includes(contentType);
}

// Never throws — anything that doesn't decode to a well-formed descriptor (including every
// non-media contentType, and any malformed/adversarial payload) is treated as "not media", not an
// error. Used on both the purge path (does this envelope have an R2 object to clean up?) and the
// delivery path (does this envelope need a presigned download URL injected?).
export function tryExtractR2Key(contentType: string, payloadBase64: string): string | null {
  if (!isMediaContentType(contentType)) return null;
  try {
    const json = Buffer.from(payloadBase64, "base64").toString("utf8");
    const descriptor = JSON.parse(json) as Partial<MediaDescriptor>;
    return typeof descriptor.r2Key === "string" && descriptor.r2Key.length > 0 ? descriptor.r2Key : null;
  } catch {
    return null;
  }
}

export interface PurgedEnvelopeInfo {
  contentType?: string;
  payload?: string;
}

// Called only after the Postgres purge transaction has already committed (ackEnvelope,
// revokeDevice, sweepExpiredEnvelopes) — an R2 failure here is logged, never allowed to look like
// the purge itself failed, since the actual retention guarantee (the Postgres delete) already
// happened by the time this runs.
export async function cleanupPurgedMedia(client: S3Client, bucket: string, info: PurgedEnvelopeInfo): Promise<void> {
  if (!info.contentType || !info.payload) return;
  const r2Key = tryExtractR2Key(info.contentType, info.payload);
  if (!r2Key) return;

  try {
    await deleteR2Object(client, bucket, r2Key);
    logMediaObjectPurged(r2Key);
  } catch (error) {
    logMediaCleanupFailed(r2Key, error);
  }
}
