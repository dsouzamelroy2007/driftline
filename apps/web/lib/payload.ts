// Envelope payloads are opaque base64 over the wire (docs/REALTIME_PROTOCOL.md) — the server never
// parses them. Text messages are this client's only contentType for now ("text/plain"); encode/
// decode UTF-8 safely rather than relying on btoa/atob's latin1-only behavior.

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
