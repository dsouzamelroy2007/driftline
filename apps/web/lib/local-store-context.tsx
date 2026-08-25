"use client";

import type { LocalStoreDb } from "@driftline/local-store";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface LocalStoreContextValue {
  db: LocalStoreDb | null;
  error: string | null;
}

const LocalStoreContext = createContext<LocalStoreContextValue>({ db: null, error: null });

export function LocalStoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<LocalStoreDb | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let closeStore: (() => Promise<void>) | undefined;
    let cancelled = false;

    // Dynamic import, not a static one: @driftline/local-store/browser pulls in sqlocal, which
    // touches Worker/OPFS APIs that don't exist during Next's server render of this client
    // component. Loading it only inside an effect keeps it off the SSR path entirely.
    import("@driftline/local-store/browser")
      .then(({ createBrowserLocalStore }) => createBrowserLocalStore())
      .then((store) => {
        if (cancelled) {
          void store.close();
          return;
        }
        closeStore = store.close;
        setDb(store.db);
      })
      .catch((storeError: unknown) => {
        setError(storeError instanceof Error ? storeError.message : "Failed to open local store");
      });

    return () => {
      cancelled = true;
      void closeStore?.();
    };
  }, []);

  return <LocalStoreContext.Provider value={{ db, error }}>{children}</LocalStoreContext.Provider>;
}

export function useLocalStore(): LocalStoreContextValue {
  return useContext(LocalStoreContext);
}
