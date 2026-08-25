"use client";

import Link from "next/link";
import { useState } from "react";

import { RequireGuest } from "../../components/auth-gate";
import { ApiError, githubOAuthStartUrl } from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { errorTextClass, inputClass, linkClass, primaryButtonClass, secondaryButtonClass } from "../../lib/ui-classes";

export default function RegisterPage() {
  const { register, deviceId } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password, displayName);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <RequireGuest>
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Create your account</h1>
          <p className="mt-1 text-sm text-text-muted">Your history stays on this device — the server never keeps it.</p>
        </div>
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
              autoComplete="name"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-text-primary">
            Email
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-text-primary">
            Password
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
            />
          </label>
          {error && (
            <p className={errorTextClass} role="alert">
              {error}
            </p>
          )}
          <button type="submit" className={primaryButtonClass} disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </button>
        </form>
        <a href={githubOAuthStartUrl(deviceId)} className={secondaryButtonClass + " text-center"}>
          Continue with GitHub
        </a>
        <p className="text-center text-sm text-text-muted">
          Already have an account?{" "}
          <Link href="/login" className={linkClass}>
            Log in
          </Link>
        </p>
      </main>
    </RequireGuest>
  );
}
