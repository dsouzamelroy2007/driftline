import { z } from "zod";

export const messageSendSchema = z.object({
  conversationId: z.string().uuid(),
  clientId: z.string().min(1),
  contentType: z.string().min(1),
  payload: z.string().min(1),
});

export const envelopeAckSchema = z.object({
  envelopeId: z.string().uuid(),
});

// Phase 6 part 5 (docs/ADR/0011-presence-and-receipts.md) — a watermark, not a per-message flag.
export const conversationReadSchema = z.object({
  conversationId: z.string().uuid(),
  throughSeq: z.number().int().positive(),
});

export type MessageSendInput = z.infer<typeof messageSendSchema>;
export type EnvelopeAckInput = z.infer<typeof envelopeAckSchema>;
export type ConversationReadInput = z.infer<typeof conversationReadSchema>;
