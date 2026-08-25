"use client";

import { primaryButtonClass } from "../lib/ui-classes";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-text-primary">Something went wrong</h1>
      <p className="max-w-sm text-text-muted">
        This is a recoverable error — nothing was lost. Your message history lives on this device regardless of what the
        app's UI just did.
      </p>
      <button type="button" className={primaryButtonClass + " max-w-xs"} onClick={reset}>
        Try again
      </button>
    </main>
  );
}
