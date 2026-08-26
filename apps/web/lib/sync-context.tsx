"use client";

import type { SyncEngine } from "@driftline/sync-engine";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";

import { useAuth } from "./auth-context";
import { useLocalStore } from "./local-store-context";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

interface SyncContextValue {
  engine: SyncEngine | null;
  connected: boolean;
  /** The underlying socket.io-client instance, for features that need to speak directly to the
   * server over events sync-engine doesn't own (device linking's device-link:* signalling). */
  socket: Socket | null;
}

const SyncContext = createContext<SyncContextValue>({ engine: null, connected: false, socket: null });

export function SyncEngineProvider({ children }: { children: ReactNode }) {
  const { status, user, deviceId, accessToken } = useAuth();
  const { db } = useLocalStore();
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !db || !user || !accessToken || !deviceId) {
      setEngine(null);
      setConnected(false);
      setSocket(null);
      return;
    }

    let disposed = false;
    const newSocket: Socket = io(SERVER_URL, { auth: { token: accessToken } });
    setSocket(newSocket);

    // Dynamic import: @driftline/sync-engine transitively imports @driftline/local-store's node
    // backend export path through its package graph in dev tooling only, but keeping this off the
    // static import graph matches the same SSR-safety reasoning as local-store-context.tsx.
    import("@driftline/sync-engine").then(({ createSyncEngine }) => {
      if (disposed) return;
      const createdEngine = createSyncEngine({ socket: newSocket, store: db, selfUserId: user.id, selfDeviceId: deviceId });
      setEngine(createdEngine);
    });

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    newSocket.on("connect", handleConnect);
    newSocket.on("disconnect", handleDisconnect);

    return () => {
      disposed = true;
      newSocket.off("connect", handleConnect);
      newSocket.off("disconnect", handleDisconnect);
      setEngine((current) => {
        current?.dispose();
        return null;
      });
      setSocket(null);
      newSocket.disconnect();
    };
    // Recreate the whole engine + socket when the access token changes (a refresh) — deviceId is
    // stable for the browser's lifetime and doesn't need to retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, db, user, accessToken]);

  return <SyncContext.Provider value={{ engine, connected, socket }}>{children}</SyncContext.Provider>;
}

export function useSyncEngine(): SyncContextValue {
  return useContext(SyncContext);
}
