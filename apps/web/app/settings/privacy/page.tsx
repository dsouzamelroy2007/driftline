"use client";

import Link from "next/link";
import { useState } from "react";

import { RequireAuth } from "../../../components/auth-gate";
import { RetentionTable } from "../../../components/retention-table";
import { linkClass, secondaryButtonClass } from "../../../lib/ui-classes";

function PrivacyContent() {
  const [deletionRequested, setDeletionRequested] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-6 py-8">
      <header className="flex items-center gap-3">
        <Link href="/settings" className={linkClass}>
          ←
        </Link>
        <h1 className="text-lg font-semibold text-text-primary">Data &amp; privacy</h1>
      </header>

      <Link href="/onboarding" className={secondaryButtonClass + " text-center"}>
        Revisit the &ldquo;history lives here&rdquo; explainer
      </Link>

      <RetentionTable />

      <section className="rounded-bubble border border-status-error/40 bg-bg-surface p-4">
        <h2 className="font-medium text-text-primary">Delete my account</h2>
        <p className="mt-1 text-sm text-text-muted">
          Permanently deletes your account, devices, and conversation memberships. This doesn&rsquo;t touch chat history
          on your devices — that&rsquo;s yours regardless.
        </p>
        {deletionRequested ? (
          <p className="mt-2 text-sm text-status-error">
            Request noted. Account deletion isn&rsquo;t wired up to a real flow yet — contact the maintainer directly for
            now.
          </p>
        ) : (
          <button type="button" className="mt-2 text-sm font-medium text-status-error underline" onClick={() => setDeletionRequested(true)}>
            Request account deletion
          </button>
        )}
      </section>
    </main>
  );
}

export default function PrivacySettingsPage() {
  return (
    <RequireAuth>
      <PrivacyContent />
    </RequireAuth>
  );
}
