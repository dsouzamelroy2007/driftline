import type { Device, User } from "@driftline/db";

import { resolveAvatarUrl } from "../modules/users/avatar.service.js";
import type { R2Context } from "../plugins/app-context.js";

export type PublicUser = Omit<User, "passwordHash">;
export type PublicDevice = Omit<Device, "refreshTokenHash">;

// Async since a self-uploaded avatar (a bare R2 key in avatarUrl, docs/ADR/0010) needs a freshly
// minted presigned GET — an external OAuth-provided URL passes through resolveAvatarUrl unchanged.
export async function toPublicUser(user: User, r2: R2Context): Promise<PublicUser> {
  const { passwordHash: _passwordHash, avatarUrl, ...publicUser } = user;
  return { ...publicUser, avatarUrl: await resolveAvatarUrl(r2, avatarUrl) };
}

export function toPublicDevice(device: Device): PublicDevice {
  const { refreshTokenHash: _refreshTokenHash, ...publicDevice } = device;
  return publicDevice;
}
