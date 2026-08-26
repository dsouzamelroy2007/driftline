"use client";

import Link from "next/link";
import { useState } from "react";

import { RequireAuth } from "../../../components/auth-gate";
import { useDeviceLinkHost, useDeviceLinkSource } from "../../../lib/device-link-client";
import { QrCodeDisplay, QrCodeScanner } from "../../../lib/qr-code";
import { errorTextClass, inputClass, linkClass, primaryButtonClass, secondaryButtonClass } from "../../../lib/ui-classes";

function HostPanel() {
  const { state, start, cancel } = useDeviceLinkHost();

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-sm text-text-muted">
        This device has no history yet. Show this code on another one of your signed-in devices to bring your messages over.
      </p>
      {state.phase === "idle" && (
        <button type="button" className={primaryButtonClass} onClick={() => void start()}>
          Show my code
        </button>
      )}
      {state.phase === "starting" && <p role="status">Generating code…</p>}
      {state.phase === "waiting" && (
        <>
          <QrCodeDisplay value={state.code} />
          <p className="font-mono text-2xl tracking-widest text-text-primary">{state.code}</p>
          <p className="text-xs text-text-muted">Expires at {new Date(state.expiresAt).toLocaleTimeString()}</p>
          <button type="button" className={secondaryButtonClass} onClick={cancel}>
            Cancel
          </button>
        </>
      )}
      {state.phase === "connecting" && <p role="status">Another device joined — connecting…</p>}
      {state.phase === "transferring" && (
        <p role="status">
          Receiving messages… {state.receivedCount}
          {state.totalItems ? ` / ${state.totalItems}` : ""}
        </p>
      )}
      {state.phase === "done" && (
        <p className="text-status-online" role="status">
          Done — restored {state.result.entriesImported} message{state.result.entriesImported === 1 ? "" : "s"} across{" "}
          {state.result.conversationsImported} conversation{state.result.conversationsImported === 1 ? "" : "s"}.
        </p>
      )}
      {state.phase === "failed" && (
        <div className="flex flex-col gap-3">
          <p className={errorTextClass} role="alert">
            {state.message}
          </p>
          <Link href="/settings/backup" className={linkClass}>
            Import a backup file instead
          </Link>
        </div>
      )}
    </div>
  );
}

function ScanPanel() {
  const { state, join, cancel } = useDeviceLinkSource();
  const [manualCode, setManualCode] = useState("");
  const [useCamera, setUseCamera] = useState(true);

  function handleScan(value: string) {
    if (state.phase === "idle") void join(value);
  }

  function handleManualSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (manualCode.length === 8) void join(manualCode);
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-sm text-text-muted">Scan or enter the code shown on your other, empty device.</p>

      {state.phase === "idle" && (
        <>
          {useCamera ? (
            <>
              <QrCodeScanner active={state.phase === "idle"} onScan={handleScan} />
              <button type="button" className={linkClass} onClick={() => setUseCamera(false)}>
                Enter the code manually instead
              </button>
            </>
          ) : (
            <form onSubmit={handleManualSubmit} className="flex w-full flex-col gap-3">
              <input
                className={`${inputClass} text-center font-mono text-xl tracking-widest`}
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                maxLength={8}
                placeholder="00000000"
              />
              <button type="submit" className={primaryButtonClass} disabled={manualCode.length !== 8}>
                Connect
              </button>
              <button type="button" className={linkClass} onClick={() => setUseCamera(true)}>
                Use the camera instead
              </button>
            </form>
          )}
        </>
      )}
      {state.phase === "joining" && <p role="status">Checking code…</p>}
      {state.phase === "connecting" && <p role="status">Connecting…</p>}
      {state.phase === "sending" && (
        <p role="status">
          Sending messages… {state.sentItems}
          {state.totalItems ? ` / ${state.totalItems}` : ""}
        </p>
      )}
      {state.phase === "done" && (
        <p className="text-status-online" role="status">
          Done — the other device now has your history.
        </p>
      )}
      {state.phase === "failed" && (
        <div className="flex flex-col gap-3">
          <p className={errorTextClass} role="alert">
            {state.message}
          </p>
          <Link href="/settings/backup" className={linkClass}>
            Export a backup file instead
          </Link>
        </div>
      )}
      {(state.phase === "connecting" || state.phase === "sending") && (
        <button type="button" className={secondaryButtonClass} onClick={cancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

function LinkDeviceContent() {
  const [mode, setMode] = useState<"host" | "scan">("host");

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-6 py-8">
      <header className="flex items-center gap-3">
        <Link href="/settings" className={linkClass}>
          ←
        </Link>
        <h1 className="text-lg font-semibold text-text-primary">Link a device</h1>
      </header>
      <div className="flex gap-2">
        <button type="button" className={mode === "host" ? primaryButtonClass : secondaryButtonClass} onClick={() => setMode("host")}>
          This is the new device
        </button>
        <button type="button" className={mode === "scan" ? primaryButtonClass : secondaryButtonClass} onClick={() => setMode("scan")}>
          This device has history
        </button>
      </div>
      <div className="rounded-bubble border border-text-muted/20 bg-bg-surface p-6">{mode === "host" ? <HostPanel /> : <ScanPanel />}</div>
    </main>
  );
}

export default function LinkDevicePage() {
  return (
    <RequireAuth>
      <LinkDeviceContent />
    </RequireAuth>
  );
}
