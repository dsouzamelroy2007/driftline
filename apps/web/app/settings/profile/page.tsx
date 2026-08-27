"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Avatar } from "../../../components/avatar";
import { RequireAuth } from "../../../components/auth-gate";
import { ApiError, updateProfile } from "../../../lib/api-client";
import { useAuth } from "../../../lib/auth-context";
import { uploadAvatar, validateAvatarFile } from "../../../lib/avatar-upload";
import { errorTextClass, inputClass, linkClass, primaryButtonClass, secondaryButtonCompactClass } from "../../../lib/ui-classes";

function AvatarSection() {
  const { user, authedCall, setUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later
    if (!file || !user) return;

    const validationError = validateAvatarFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const { r2Key } = await authedCall((token) => uploadAvatar(token, file));
      const { user: updated } = await authedCall((token) => updateProfile(token, { displayName: user.displayName, avatarUrl: r2Key }));
      setUser(updated);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Couldn't update your photo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      const { user: updated } = await authedCall((token) => updateProfile(token, { displayName: user.displayName, avatarUrl: null }));
      setUser(updated);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Couldn't remove your photo. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <div className="flex flex-col items-center gap-3">
      <Avatar name={user.displayName} avatarUrl={user.avatarUrl} size="lg" />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(event) => void handleFileSelected(event)}
      />
      <div className="flex gap-2">
        <button type="button" className={secondaryButtonCompactClass} onClick={() => fileInputRef.current?.click()} disabled={busy}>
          {busy ? "Working…" : "Change photo"}
        </button>
        {user.avatarUrl && (
          <button type="button" className={secondaryButtonCompactClass} onClick={() => void handleRemove()} disabled={busy}>
            Remove
          </button>
        )}
      </div>
      {error && (
        <p className={errorTextClass} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

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
      const { user: updated } = await authedCall((token) => updateProfile(token, { displayName }));
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
      <AvatarSection />
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
