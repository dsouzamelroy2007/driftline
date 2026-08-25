// Reads the (unverified — signature verification is the server's job, this is just local
// bookkeeping) deviceId claim apps/server's lib/tokens.ts puts on every access token. Only needed
// for the OAuth callback path, where the redirect carries tokens but not a Device object the way
// register/login/magic-link's JSON responses do.
export function decodeAccessTokenDeviceId(accessToken: string): string | null {
  try {
    const [, payloadSegment] = accessToken.split(".");
    if (!payloadSegment) return null;
    const payload: unknown = JSON.parse(atob(payloadSegment.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload && typeof payload === "object" && "deviceId" in payload && typeof payload.deviceId === "string") {
      return payload.deviceId;
    }
    return null;
  } catch {
    return null;
  }
}
