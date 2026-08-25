"use client";

import Link from "next/link";
import { useState } from "react";

import { RequireAuth } from "../../../components/auth-gate";
import { ApiError, updateProfile } from "../../../lib/api-client";
import { useAuth } from "../../../lib/auth-context";
import { errorTextClass, inputClass, linkClass, primaryButtonClass } from "../../../lib/ui-classes";

function ProfileContent() {
  const { user, authedCall, setUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSubmitting(true);
    try {
      const { user: updated } = await authedCall((token) => updateProfile(token, displayName));
      setUser(updated);
      setSaved(true);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Couldn't save. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <header className="flex items-center gap-3">
        <Link href="/settings" className={linkClass}>
          ←
        </Link>
        <h1 className="text-lg font-semibold text-text-primary">Edit profile</h1>
      </header>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-text-primary">
          Display name
          <input
            className={inputClass}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            minLength={1}
            maxLength={80}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-primary">
          Email
          <input className={inputClass} value={user?.email ?? ""} disabled />
        </label>
        {error && (
          <p className={errorTextClass} role="alert">
            {error}
          </p>
        )}
        {saved && <p className="text-sm text-status-online">Saved.</p>}
        <button type="submit" className={primaryButtonClass} disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </button>
      </form>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  );
}
