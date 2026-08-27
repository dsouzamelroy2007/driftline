import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { env as Env } from "../env.js";

// R2 is S3-API-compatible (docs/ADR/0009-media-attachments.md) — this is the standard client for
// it, the same way ioredis/pg are the unquestioned choices for their own protocols. "auto" region
// is R2's documented value; there's no real region concept for R2 buckets.
export function createR2Client(env: Pick<typeof Env, "R2_ACCOUNT_ID" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY">): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

const UPLOAD_URL_TTL_SECONDS = 300;
const DOWNLOAD_URL_TTL_SECONDS = 300;

// The client PUTs the raw file bytes straight to R2 with this URL — they never pass through this
// server (docs/ADR/0009). ContentLength is the claimed size validated by the caller before this is
// minted; R2 doesn't cryptographically enforce it matches the actual upload (documented limitation).
export async function createUploadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
  size: number,
): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: size });
  return getSignedUrl(client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
}

// Minted fresh at delivery time (modules/relay/socket.ts's toWireEnvelope) — the act of delivering
// this envelope to this device is the authorization check, so there's no separate download-auth
// endpoint that would need its own membership lookup. `expiresInSeconds` defaults to the short
// message-media TTL above; callers with a longer-lived use case (e.g. avatars, resolved once and
// displayed for a whole session — see modules/users/avatar.service.ts) pass their own.
export async function createDownloadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  expiresInSeconds: number = DOWNLOAD_URL_TTL_SECONDS,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

// Called only after the Postgres purge transaction has already committed (modules/media/
// media.service.ts's cleanupPurgedMedia) — never allowed to be on the critical path of the actual
// retention guarantee.
export async function deleteR2Object(client: S3Client, bucket: string, key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
