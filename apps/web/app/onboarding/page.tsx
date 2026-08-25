"use client";

import { useRouter } from "next/navigation";

import { RequireAuth } from "../../components/auth-gate";
import { markOnboardingSeen } from "../../lib/onboarding";
import { primaryButtonClass } from "../../lib/ui-classes";

export default function OnboardingPage() {
  const router = useRouter();

  function handleContinue() {
    markOnboardingSeen();
    router.replace("/chat");
  }

  return (
    <RequireAuth>
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12 text-center">
        <h1 className="text-2xl font-semibold text-text-primary">Your history lives here — on this device</h1>
        <p className="text-base text-text-muted">
          Driftline&rsquo;s server holds a message only until every device you own has confirmed receipt, or for 30 days
          at most — whichever comes first. After that, it&rsquo;s gone from the server, permanently.
        </p>
        <p className="text-base text-text-muted">
          That means your chat history exists only on the devices where you&rsquo;ve read it. Losing a device without a
          backup or a linked device means losing that history too. You can revisit this any time from Settings → Data
          &amp; privacy.
        </p>
        <button type="button" className={primaryButtonClass} onClick={handleContinue}>
          Got it
        </button>
      </main>
    </RequireAuth>
  );
}
