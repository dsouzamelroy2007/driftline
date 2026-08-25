// Hand-written mirrors of apps/server's public response shapes (lib/serialize.ts's PublicUser/
// PublicDevice, etc). Deliberately not imported from @driftline/db — that package pulls in the
// `pg` Node driver, which has no business in a browser bundle.

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export type Platform = "web" | "ios" | "android";

export interface Device {
  id: string;
  userId: string;
  platform: Platform;
  publicKey: string | null;
  pushToken: string | null;
  lastSeenAt: string;
  dormantAt: string | null;
  revokedAt: string | null;
  refreshTokenExpiresAt: string | null;
  createdAt: string;
}

export interface ConversationMemberSummary {
  userId: string;
  displayName: string;
}

export type ConversationType = "direct" | "group";

export interface Conversation {
  id: string;
  type: ConversationType;
  createdAt: string;
  members: ConversationMemberSummary[];
}

export interface StorageSummary {
  envelopeCount: number;
  oldestExpiresAt: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: User;
  device: Device;
}
