import type { ImportTimelineEntriesResult, LocalStoreDb } from "@driftline/local-store";

import { decryptWithPassphrase, encryptWithPassphrase, type EncryptedEnvelope } from "./crypto.js";
import { applyBackupPayload, collectBackupPayload, type BackupPayload } from "./serialize.js";

// docs/BACKUP_FORMAT.md — a self-describing marker distinguishes a Driftline backup file from any
// other JSON someone might pick in the file dialog, checked before attempting decryption at all.
const FILE_KIND = "driftline-backup";

export interface BackupFile extends EncryptedEnvelope {
  kind: typeof FILE_KIND;
}

const BACKUP_FILE_MIME = "application/json";

export interface ExportBackupOptions {
  store: LocalStoreDb;
  passphrase: string;
}

export async function exportBackup({ store, passphrase }: ExportBackupOptions): Promise<Blob> {
  const payload = await collectBackupPayload(store);
  const envelope = await encryptWithPassphrase(JSON.stringify(payload), passphrase);
  const file: BackupFile = { kind: FILE_KIND, ...envelope };
  return new Blob([JSON.stringify(file)], { type: BACKUP_FILE_MIME });
}

export interface ImportBackupOptions {
  store: LocalStoreDb;
  fileBytes: ArrayBuffer | Blob | string;
  passphrase: string;
}

export async function importBackup({ store, fileBytes, passphrase }: ImportBackupOptions): Promise<ImportTimelineEntriesResult> {
  const text =
    typeof fileBytes === "string"
      ? fileBytes
      : fileBytes instanceof Blob
        ? await fileBytes.text()
        : new TextDecoder().decode(fileBytes);

  let file: BackupFile;
  try {
    file = JSON.parse(text) as BackupFile;
  } catch {
    throw new Error("This doesn't look like a Driftline backup file.");
  }
  if (file.kind !== FILE_KIND || file.version !== 1) {
    throw new Error("This doesn't look like a Driftline backup file.");
  }

  const plaintext = await decryptWithPassphrase(file, passphrase);
  const payload = JSON.parse(plaintext) as BackupPayload;
  return applyBackupPayload(store, payload);
}
