const DEVICE_ID_KEY = "driftline.deviceId";

// The *server-assigned* device row id (Device.id from apps/server/src/modules/devices), not a
// client-minted one. upsertDevice (apps/server/src/modules/auth/auth.service.ts) only reuses a
// device row when the deviceId it's given matches an existing row's own id — the id it assigns on
// first creation is always a fresh server-side uuid, unrelated to whatever value the client sends
// on that first call. So the right flow is: send no deviceId (or an unrecognized one) on the very
// first auth call, then persist whatever device.id the server hands back, and send that on every
// call after. A client-generated id that's never actually a real device row's id would look
// harmless but would silently mint a brand-new device on every single login.
export function getStoredDeviceId(): string | null {
  return localStorage.getItem(DEVICE_ID_KEY);
}

export function setStoredDeviceId(deviceId: string): void {
  localStorage.setItem(DEVICE_ID_KEY, deviceId);
}
