"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import * as api from "./api-client";
import { ApiError } from "./api-client";
import { getStoredDeviceId, setStoredDeviceId } from "./device-id";
import { decodeAccessTokenDeviceId } from "./jwt";
import type { AuthResult, Device, User } from "./types";

const REFRESH_TOKEN_KEY = "driftline.refreshToken";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  device: Device | null;
  /** The server-assigned device row id for this browser install, once known — null until this
   * browser has completed its first successful auth. */
  deviceId: string | null;
  accessToken: string | null;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  requestMagicLink: (email: string) => Promise<void>;
  verifyMagicLink: (token: string) => Promise<void>;
  completeOAuthCallback: (accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Calls an authenticated API function, refreshing the access token and retrying once on 401. */
  authedCall: <T>(fn: (accessToken: string) => Promise<T>) => Promise<T>;
  /** Updates the cached user (e.g. after PATCH /me) without a full session refresh. */
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  // null until the mount effect below runs — matches SSR's output so hydration doesn't mismatch,
  // then fills in immediately after mount (localStorage is browser-only).
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    setDeviceId(getStoredDeviceId());
  }, []);

  const applyAuthResult = useCallback((result: AuthResult) => {
    localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
    setStoredDeviceId(result.device.id);
    setDeviceId(result.device.id);
    setUser(result.user);
    setDevice(result.device);
    setAccessToken(result.accessToken);
    setStatus("authenticated");
  }, []);

  useEffect(() => {
    const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!storedRefreshToken) {
      setStatus("unauthenticated");
      return;
    }

    (async () => {
      try {
        const tokens = await api.refreshTokens(storedRefreshToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
        const { user: restoredUser } = await api.getMe(tokens.accessToken);
        setUser(restoredUser);
        setAccessToken(tokens.accessToken);
        setStatus("authenticated");
      } catch {
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        setStatus("unauthenticated");
      }
    })();
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const result = await api.register({
        email,
        password,
        displayName,
        device: deviceId ? { deviceId, platform: "web" } : { platform: "web" },
      });
      applyAuthResult(result);
    },
    [applyAuthResult, deviceId],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.login({
        email,
        password,
        device: deviceId ? { deviceId, platform: "web" } : { platform: "web" },
      });
      applyAuthResult(result);
    },
    [applyAuthResult, deviceId],
  );

  const requestMagicLink = useCallback(
    async (email: string) => {
      await api.requestMagicLink({ email, device: deviceId ? { deviceId, platform: "web" } : { platform: "web" } });
    },
    [deviceId],
  );

  const verifyMagicLink = useCallback(
    async (token: string) => {
      const result = await api.verifyMagicLink(token);
      applyAuthResult(result);
    },
    [applyAuthResult],
  );

  const completeOAuthCallback = useCallback(async (newAccessToken: string, refreshToken: string) => {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    const realDeviceId = decodeAccessTokenDeviceId(newAccessToken);
    if (realDeviceId) {
      setStoredDeviceId(realDeviceId);
      setDeviceId(realDeviceId);
    }
    const { user: oauthUser } = await api.getMe(newAccessToken);
    setUser(oauthUser);
    setAccessToken(newAccessToken);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    if (accessToken) {
      await api.logout(accessToken).catch(() => undefined);
    }
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    setUser(null);
    setDevice(null);
    setAccessToken(null);
    setStatus("unauthenticated");
  }, [accessToken]);

  const authedCall = useCallback(
    async <T,>(fn: (token: string) => Promise<T>): Promise<T> => {
      if (!accessToken) {
        throw new ApiError(401, "Not authenticated");
      }
      try {
        return await fn(accessToken);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) {
          throw error;
        }
        const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!storedRefreshToken) {
          throw error;
        }
        const tokens = await api.refreshTokens(storedRefreshToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
        setAccessToken(tokens.accessToken);
        return fn(tokens.accessToken);
      }
    },
    [accessToken],
  );

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        device,
        deviceId,
        accessToken,
        register,
        login,
        requestMagicLink,
        verifyMagicLink,
        completeOAuthCallback,
        logout,
        authedCall,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
