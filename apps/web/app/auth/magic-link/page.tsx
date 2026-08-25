"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { RequireGuest } from "../../../components/auth-gate";
import { ApiError } from "../../../lib/api-client";
import { useAuth } from "../../../lib/auth-context";
import { errorTextClass, inputClass, primaryButtonClass } from "../../../lib/ui-classes";

function VerifyingToken({ token }: { token: string }) {
  const { verifyMagicLink } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    verifyMagicLink(token).catch((verifyError: unknown) => {
      setError(verifyError instanceof ApiError ? verifyError.message : "This link is invalid or has expired.");
    });
    // Intentionally run once per token — verifyMagicLink is a one-time-use action server-side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <p className={errorTextClass}>{error}</p>
        <a href="/auth/magic-link" className="text-sm text-accent-primary underline">
          Request a new link
        </a>
      </div>
    );
  }

  return (
    <p className="text-center text-text-muted" role="status">
      Logging you in…
    </p>
  );
}

function RequestForm() {
  const { requestMagicLink } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestMagicLink(email);
      setSent(true);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <p className="text-center text-text-muted" role="status">
        Check <strong className="text-text-primary">{email}</strong> for a login link. It expires in a few minutes.
      </p>
    );
  }

  return (
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
      {error && (
        <p className={errorTextClass} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className={primaryButtonClass} disabled={submitting}>
        {submitting ? "Sending…" : "Send login link"}
      </button>
    </form>
  );
}

function MagicLinkContent() {
  const token = useSearchParams().get("token");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-xl font-semibold text-text-primary">Log in with email</h1>
      {token ? <VerifyingToken token={token} /> : <RequestForm />}
    </main>
  );
}

export default function MagicLinkPage() {
  return (
    <RequireGuest>
      <Suspense fallback={null}>
        <MagicLinkContent />
      </Suspense>
    </RequireGuest>
  );
}
