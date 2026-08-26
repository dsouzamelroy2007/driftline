// Envelope payloads are opaque base64 over the wire (docs/REALTIME_PROTOCOL.md) — the server never
// parses them. Text messages are the only contentType clients send for now ("text/plain"); encode/
// decode UTF-8 safely rather than relying on btoa/atob's latin1-only behavior. Lives here (not just
// in apps/web) because repository.ts's insert functions need the decode half to populate the
// search index (see searchTimeline) — moved verbatim from apps/web/lib/payload.ts.
export function encodeTextPayload(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeTextPayload(payload: string): string {
  const binary = atob(payload);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
