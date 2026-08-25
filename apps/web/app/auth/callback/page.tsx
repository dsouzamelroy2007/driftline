"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useAuth } from "../../../lib/auth-context";
import { errorTextClass, linkClass } from "../../../lib/ui-classes";

// apps/server's oauth.routes.ts redirects here with either `#accessToken=&refreshToken=` (a hash
// fragment, never sent to the server, so tokens don't end up in access logs) or `?error=`.
function CallbackContent() {
  const router = useRouter();
  const queryError = useSearchParams().get("error");
  const { completeOAuthCallback } = useAuth();
  const [error, setError] = useState<string | null>(queryError);

  useEffect(() => {
    if (queryError) return;

    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hashParams.get("accessToken");
    const refreshToken = hashParams.get("refreshToken");
    if (!accessToken || !refreshToken) {
      setError("invalid_request");
      return;
    }

    completeOAuthCallback(accessToken, refreshToken)
      .then(() => router.replace("/chat"))
      .catch(() => setError("invalid_request"));
    // Runs once against the tokens present in the URL at load time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryError]);

  if (error) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <p className={errorTextClass}>Sign-in with GitHub didn&rsquo;t work. Please try again.</p>
        <a href="/login" className={linkClass}>
          Back to login
        </a>
      </div>
    );
  }

  return (
    <p className="text-center text-text-muted" role="status">
      Signing you in…
    </p>
  );
}

export default function OAuthCallbackPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <Suspense fallback={null}>
        <CallbackContent />
      </Suspense>
    </main>
  );
}
