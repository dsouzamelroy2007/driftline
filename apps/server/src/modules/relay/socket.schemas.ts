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

export type MessageSendInput = z.infer<typeof messageSendSchema>;
export type EnvelopeAckInput = z.infer<typeof envelopeAckSchema>;
