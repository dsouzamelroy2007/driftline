"use client";

import { exportBackup, importBackup, type ImportTimelineEntriesResult } from "@driftline/backup";
import { listOutboxEntries } from "@driftline/local-store";
import { useCallback } from "react";

import { useLocalStore } from "./local-store-context";

export interface UseBackupResult {
  ready: boolean;
  exportBackupFile: (passphrase: string) => Promise<Blob>;
  importBackupFile: (file: File, passphrase: string) => Promise<ImportTimelineEntriesResult>;
  hasPendingOutboxEntries: () => Promise<boolean>;
}

// Thin wrapper over @driftline/backup — all the crypto/serialization logic lives there, this just
// supplies the local-store instance from context (docs/BACKUP_FORMAT.md).
export function useBackup(): UseBackupResult {
  const { db } = useLocalStore();

  const exportBackupFile = useCallback(
    async (passphrase: string) => {
      if (!db) throw new Error("Local store isn't ready yet");
      return exportBackup({ store: db, passphrase });
    },
    [db],
  );

  const importBackupFile = useCallback(
    async (file: File, passphrase: string) => {
      if (!db) throw new Error("Local store isn't ready yet");
      return importBackup({ store: db, fileBytes: file, passphrase });
    },
    [db],
  );

  // Surfaced as a one-line warning before import proceeds — importing never touches the outbox,
  // but a user with unsent messages should know that before they trigger a restore mid-send.
  const hasPendingOutboxEntries = useCallback(async () => {
    if (!db) return false;
    const entries = await listOutboxEntries(db);
    return entries.length > 0;
  }, [db]);

  return { ready: db !== null, exportBackupFile, importBackupFile, hasPendingOutboxEntries };
}
