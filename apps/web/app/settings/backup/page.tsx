"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { RequireAuth } from "../../../components/auth-gate";
import { useBackup } from "../../../lib/backup-client";
import { recordBackupCompleted } from "../../../lib/backup-nag";
import { errorTextClass, inputClass, linkClass, primaryButtonClass, secondaryButtonClass } from "../../../lib/ui-classes";

function ExportSection() {
  const { exportBackupFile, ready } = useBackup();
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (passphrase.length < 8) {
      setError("Use a passphrase of at least 8 characters.");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError("Passphrases don't match.");
      return;
    }

    setBusy(true);
    try {
      const blob = await exportBackupFile(passphrase);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `driftline-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      recordBackupCompleted();
      setPassphrase("");
      setConfirmPassphrase("");
    } catch {
      setError("Couldn't create a backup. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleExport} className="flex flex-col gap-4">
      <h2 className="font-medium text-text-primary">Export</h2>
      <p className="text-sm text-text-muted">
        Downloads an encrypted file with every message currently on this device. Anyone who gets the file still needs your
        passphrase to read it — choose one you&rsquo;ll remember, since there&rsquo;s no way to recover it if you forget.
      </p>
      <label className="flex flex-col gap-1 text-sm text-text-primary">
        Passphrase
        <input
          type="password"
          className={inputClass}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          required
          minLength={8}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-text-primary">
        Confirm passphrase
        <input
          type="password"
          className={inputClass}
          value={confirmPassphrase}
          onChange={(event) => setConfirmPassphrase(event.target.value)}
          required
        />
      </label>
      {error && (
        <p className={errorTextClass} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className={primaryButtonClass} disabled={busy || !ready}>
        {busy ? "Creating backup…" : "Export backup"}
      </button>
    </form>
  );
}

function ImportSection() {
  const { importBackupFile, hasPendingOutboxEntries, ready } = useBackup();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ conversationsImported: number; entriesImported: number } | null>(null);
  const [outboxWarning, setOutboxWarning] = useState(false);

  async function handleImport(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a backup file.");
      return;
    }

    setBusy(true);
    try {
      setOutboxWarning(await hasPendingOutboxEntries());
      const importResult = await importBackupFile(file, passphrase);
      setResult(importResult);
      setPassphrase("");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Couldn't import this backup.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleImport} className="flex flex-col gap-4">
      <h2 className="font-medium text-text-primary">Import</h2>
      <p className="text-sm text-text-muted">
        Restores messages from a Driftline backup file into this device&rsquo;s history. Existing messages are kept — importing
        only adds what this device doesn&rsquo;t already have.
      </p>
      <label className="flex flex-col gap-1 text-sm text-text-primary">
        Backup file
        <input ref={fileInputRef} type="file" accept="application/json" className={inputClass} required />
      </label>
      <label className="flex flex-col gap-1 text-sm text-text-primary">
        Passphrase
        <input
          type="password"
          className={inputClass}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          required
        />
      </label>
      {outboxWarning && (
        <p className="text-sm text-accent-retention">
          You have unsent messages — importing won&rsquo;t affect them, but message order may look unusual until they send.
        </p>
      )}
      {error && (
        <p className={errorTextClass} role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="text-sm text-status-online" role="status">
          Restored {result.entriesImported} message{result.entriesImported === 1 ? "" : "s"} across {result.conversationsImported}{" "}
          conversation{result.conversationsImported === 1 ? "" : "s"}.
        </p>
      )}
      <button type="submit" className={secondaryButtonClass} disabled={busy || !ready}>
        {busy ? "Restoring…" : "Import backup"}
      </button>
    </form>
  );
}

function BackupContent() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-6 py-8">
      <header className="flex items-center gap-3">
        <Link href="/settings" className={linkClass}>
          ←
        </Link>
        <h1 className="text-lg font-semibold text-text-primary">Backup &amp; restore</h1>
      </header>
      <div className="flex flex-col gap-3 rounded-bubble border border-text-muted/20 bg-bg-surface p-4">
        <ExportSection />
      </div>
      <div className="flex flex-col gap-3 rounded-bubble border border-text-muted/20 bg-bg-surface p-4">
        <ImportSection />
      </div>
    </main>
  );
}

export default function BackupPage() {
  return (
    <RequireAuth>
      <BackupContent />
    </RequireAuth>
  );
}
