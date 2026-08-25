"use client";

import Link from "next/link";
import { useState } from "react";

import { RequireGuest } from "../../components/auth-gate";
import { ApiError, githubOAuthStartUrl } from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { errorTextClass, inputClass, linkClass, primaryButtonClass, secondaryButtonClass } from "../../lib/ui-classes";

export default function LoginPage() {
  const { login, deviceId } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <RequireGuest>
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
        <h1 className="text-xl font-semibold text-text-primary">Log in</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className={errorTextClass} role="alert">
              {error}
            </p>
          )}
          <button type="submit" className={primaryButtonClass} disabled={submitting}>
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>
        <Link href="/auth/magic-link" className={linkClass + " text-center text-sm"}>
          Email me a login link instead
        </Link>
        <a href={githubOAuthStartUrl(deviceId)} className={secondaryButtonClass + " text-center"}>
          Continue with GitHub
        </a>
        <p className="text-center text-sm text-text-muted">
          New here?{" "}
          <Link href="/register" className={linkClass}>
            Create an account
          </Link>
        </p>
      </main>
    </RequireGuest>
  );
}
