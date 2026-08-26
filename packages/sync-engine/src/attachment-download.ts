const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

// Same byte-to-base64 primitive already proven in packages/backup/src/crypto.ts — a loop, not a
// spread, so it doesn't blow the call stack on a multi-megabyte image.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Downloads a media attachment from its presigned URL, retried with backoff — a transient network
// blip shouldn't permanently lose an image the sender already sent. Returns undefined only once
// every attempt has failed; the caller (create-sync-engine.ts's handleEnvelopeDeliver) must not
// insert or ack in that case — the envelope stays pending server-side and is redelivered, with a
// fresh URL, on this device's next reconnect (docs/ADR/0009-media-attachments.md). This is the
// load-bearing property: once acked, the server may purge the R2 object at any time, so the bytes
// must be durably saved locally *before* acking, exactly mirroring why a text message's own local
// write already commits before its ack goes out.
export async function downloadAttachment(url: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Attachment download failed: HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      return bytesToBase64(new Uint8Array(buffer));
    } catch (error) {
      if (attempt === MAX_ATTEMPTS - 1) {
        console.error("sync-engine: attachment download failed after retries", error);
        return undefined;
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  return undefined;
}
