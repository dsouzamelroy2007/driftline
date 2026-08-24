import type { Device, User } from "@driftline/db";

export type PublicUser = Omit<User, "passwordHash">;
export type PublicDevice = Omit<Device, "refreshTokenHash">;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

export function toPublicDevice(device: Device): PublicDevice {
  const { refreshTokenHash: _refreshTokenHash, ...publicDevice } = device;
  return publicDevice;
}
