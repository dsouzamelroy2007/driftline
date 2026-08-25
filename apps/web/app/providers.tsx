"use client";

import type { ReactNode } from "react";

import { AuthProvider } from "../lib/auth-context";
import { LocalStoreProvider } from "../lib/local-store-context";
import { SyncEngineProvider } from "../lib/sync-context";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <LocalStoreProvider>
        <SyncEngineProvider>{children}</SyncEngineProvider>
      </LocalStoreProvider>
    </AuthProvider>
  );
}
