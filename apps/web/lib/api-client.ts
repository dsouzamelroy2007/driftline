import type {
  AuthResult,
  Conversation,
  ConversationType,
  Device,
  StorageSummary,
  TokenPair,
  User,
} from "./types";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Only set Content-Type when there's actually a body — Fastify's JSON body parser rejects an
  // empty body sent with Content-Type: application/json (FST_ERR_CTP_EMPTY_JSON_BODY, a 400), which
  // is exactly what a bodyless authed POST like /auth/logout otherwise triggers.
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : response.statusText;
    throw new ApiError(response.status, message);
  }

  return body as T;
}

function authed(accessToken: string): RequestInit {
  return { headers: { Authorization: `Bearer ${accessToken}` } };
}

export interface DeviceInfoInput {
  deviceId?: string;
  platform: "web";
}

export function register(input: { email: string; password: string; displayName: string; device: DeviceInfoInput }): Promise<AuthResult> {
  return request("/auth/register", { method: "POST", body: JSON.stringify(input) });
}

export function login(input: { email: string; password: string; device: DeviceInfoInput }): Promise<AuthResult> {
  return request("/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function refreshTokens(refreshToken: string): Promise<TokenPair> {
  return request("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }) });
}

export function logout(accessToken: string): Promise<void> {
  return request("/auth/logout", { method: "POST", ...authed(accessToken) });
}

export function requestMagicLink(input: { email: string; device: DeviceInfoInput }): Promise<void> {
  return request("/auth/magic-link/request", { method: "POST", body: JSON.stringify(input) });
}

export function verifyMagicLink(token: string): Promise<AuthResult> {
  return request("/auth/magic-link/verify", { method: "POST", body: JSON.stringify({ token }) });
}

export function githubOAuthStartUrl(deviceId: string | null): string {
  const url = new URL("/auth/oauth/github/start", SERVER_URL);
  if (deviceId) url.searchParams.set("deviceId", deviceId);
  url.searchParams.set("platform", "web");
  return url.toString();
}

export function getMe(accessToken: string): Promise<{ user: User }> {
  return request("/me", authed(accessToken));
}

export function updateProfile(accessToken: string, displayName: string): Promise<{ user: User }> {
  return request("/me", { method: "PATCH", body: JSON.stringify({ displayName }), ...authed(accessToken) });
}

export function lookupUserByEmail(accessToken: string, email: string): Promise<{ user: User }> {
  const url = new URL("/users/lookup", SERVER_URL);
  url.searchParams.set("email", email);
  return request(url.pathname + url.search, authed(accessToken));
}

export function listDevices(accessToken: string): Promise<{ devices: Device[] }> {
  return request("/devices", authed(accessToken));
}

export function revokeDevice(accessToken: string, deviceId: string): Promise<void> {
  return request(`/devices/${deviceId}`, { method: "DELETE", ...authed(accessToken) });
}

export function listConversations(accessToken: string): Promise<{ conversations: Conversation[] }> {
  return request("/conversations", authed(accessToken));
}

export function createConversation(
  accessToken: string,
  input: { type: ConversationType; participantUserIds: string[] },
): Promise<{ conversation: Conversation }> {
  return request("/conversations", { method: "POST", body: JSON.stringify(input), ...authed(accessToken) });
}

export function getStorageSummary(accessToken: string): Promise<StorageSummary> {
  return request("/me/storage", authed(accessToken));
}
