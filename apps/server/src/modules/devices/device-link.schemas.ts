import { z } from "zod";

// docs/ADR/0008-device-linking-protocol.md — the same 8-digit code is used both as the QR payload
// and the manual-entry fallback (a single credential, not two), protected by a short TTL and a
// per-session attempt cap rather than by code length alone.
export const deviceLinkStartResponseSchema = z.object({
  code: z.string().length(8),
  expiresAt: z.string(),
});

export const deviceLinkJoinSchema = z.object({
  code: z.string().length(8),
});

export const deviceLinkSignalSchema = z.object({
  code: z.string().length(8),
  targetDeviceId: z.string().uuid(),
  // Opaque WebRTC SDP/ICE-candidate JSON — the server relays it without ever parsing it
  // (ADR-0003: signalling only, never content).
  signal: z.unknown(),
});

export const deviceLinkCancelSchema = z.object({
  code: z.string().length(8),
});

export type DeviceLinkJoinInput = z.infer<typeof deviceLinkJoinSchema>;
export type DeviceLinkSignalInput = z.infer<typeof deviceLinkSignalSchema>;
export type DeviceLinkCancelInput = z.infer<typeof deviceLinkCancelSchema>;
