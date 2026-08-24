import { z } from "zod";

// Roadmap group cap is 100 members total, including the creator, so at most 99 other participants.
export const createConversationSchema = z.object({
  type: z.enum(["direct", "group"]),
  participantUserIds: z.array(z.string().uuid()).min(1).max(99),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
