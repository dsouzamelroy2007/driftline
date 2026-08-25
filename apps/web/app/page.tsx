"use client";

import Link from "next/link";

import { RequireGuest } from "../components/auth-gate";
import { linkClass, primaryButtonClass, secondaryButtonClass } from "../lib/ui-classes";

export default function WelcomePage() {
  return (
    <RequireGuest>
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
        <div className="flex max-w-md flex-col gap-4">
          <h1 className="text-2xl font-semibold text-text-primary">Your messages live on your device, not ours.</h1>
          <p className="text-base text-text-muted">
            Driftline is a local-first, real-time chat app. The server is a transport, not an archive — it forgets every
            message the moment everyone has it, or after 30 days, whichever comes first.
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <Link href="/register" className={primaryButtonClass + " text-center"}>
            Create an account
          </Link>
          <Link href="/login" className={secondaryButtonClass + " text-center"}>
            Log in
          </Link>
        </div>
        <Link href="/privacy" className={linkClass + " text-sm"}>
          What we store and for how long
        </Link>
      </main>
    </RequireGuest>
  );
}
