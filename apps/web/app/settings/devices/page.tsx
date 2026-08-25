"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { RequireAuth } from "../../../components/auth-gate";
import { listDevices, revokeDevice } from "../../../lib/api-client";
import { useAuth } from "../../../lib/auth-context";
import { daysUntilDormant } from "../../../lib/dormancy";
import { linkClass } from "../../../lib/ui-classes";
import type { Device } from "../../../lib/types";

function DevicesContent() {
  const { authedCall, deviceId: thisDeviceId } = useAuth();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function load() {
    authedCall((token) => listDevices(token))
      .then((result) => setDevices(result.devices))
      .catch(() => setDevices([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRevoke(id: string) {
    await authedCall((token) => revokeDevice(token, id));
    setConfirmingId(null);
    load();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-6 py-8">
      <header className="flex items-center gap-3">
        <Link href="/settings" className={linkClass}>
          ←
        </Link>
        <h1 className="text-lg font-semibold text-text-primary">Devices</h1>
      </header>

      {!devices ? (
        <p className="text-text-muted" role="status">
          Loading…
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {devices.map((device) => (
            <li key={device.id} className="rounded-bubble border border-text-muted/20 bg-bg-surface p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-text-primary">
                    {device.platform} {device.id === thisDeviceId && <span className="text-text-muted">(this device)</span>}
                  </p>
                  <p className="text-sm text-text-muted">Last seen {new Date(device.lastSeenAt).toLocaleString()}</p>
                  {device.dormantAt ? (
                    <p className="text-sm text-accent-retention">Dormant — excluded from new message delivery</p>
                  ) : (
                    <p className="text-sm text-text-muted">
                      Goes dormant in {daysUntilDormant(device.lastSeenAt)} day{daysUntilDormant(device.lastSeenAt) === 1 ? "" : "s"} if inactive
                    </p>
                  )}
                </div>
                {confirmingId === device.id ? (
                  <div className="flex flex-col items-end gap-1">
                    <button type="button" className="text-sm font-medium text-status-error" onClick={() => handleRevoke(device.id)}>
                      Confirm revoke
                    </button>
                    <button type="button" className="text-xs text-text-muted" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" className="text-sm text-status-error" onClick={() => setConfirmingId(device.id)}>
                    Revoke
                  </button>
                )}
              </div>
              {confirmingId === device.id && (
                <p className="mt-2 text-xs text-text-muted">
                  Pending messages to this device will be lost — this can&rsquo;t be undone.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function DevicesPage() {
  return (
    <RequireAuth>
      <DevicesContent />
    </RequireAuth>
  );
}
