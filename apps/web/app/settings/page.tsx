"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { RequireAuth } from "../../components/auth-gate";
import { getStorageSummary } from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { linkClass, secondaryButtonClass } from "../../lib/ui-classes";
import type { StorageSummary } from "../../lib/types";

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function SettingsContent() {
  const { user, authedCall, logout } = useAuth();
  const router = useRouter();
  const [storage, setStorage] = useState<StorageSummary | null>(null);

  useEffect(() => {
    authedCall((token) => getStorageSummary(token))
      .then(setStorage)
      .catch(() => setStorage(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-6 py-8">
      <header className="flex items-center gap-3">
        <Link href="/chat" className={linkClass}>
          ←
        </Link>
        <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
      </header>

      <section className="rounded-bubble border border-text-muted/20 bg-bg-surface p-4">
        <p className="font-medium text-text-primary">{user?.displayName}</p>
        <p className="text-sm text-text-muted">{user?.email}</p>
      </section>

      <section className="rounded-bubble border border-accent-retention/40 bg-bg-surface p-4">
        <p className="text-sm font-medium text-accent-retention">Server storage</p>
        {storage ? (
          <>
            <p className="mt-1 text-text-primary">
              You currently have <strong>{storage.envelopeCount}</strong> message{storage.envelopeCount === 1 ? "" : "s"} held on
              our servers.
            </p>
            {storage.oldestExpiresAt && (
              <p className="mt-1 text-sm text-text-muted">
                The oldest will be automatically deleted in {daysUntil(storage.oldestExpiresAt)} day
                {daysUntil(storage.oldestExpiresAt) === 1 ? "" : "s"} if not delivered sooner.
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-text-muted">Loading…</p>
        )}
      </section>

      <nav className="flex flex-col gap-2">
        <Link href="/settings/profile" className={secondaryButtonClass + " text-center"}>
          Edit profile
        </Link>
        <Link href="/settings/devices" className={secondaryButtonClass + " text-center"}>
          Devices
        </Link>
        <Link href="/settings/privacy" className={secondaryButtonClass + " text-center"}>
          Data &amp; privacy
        </Link>
      </nav>

      <button type="button" className={secondaryButtonClass + " text-status-error"} onClick={handleLogout}>
        Log out
      </button>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsContent />
    </RequireAuth>
  );
}
