import Link from "next/link";

import { linkClass } from "../../lib/ui-classes";

export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-6 py-8">
      <Link href="/" className={linkClass}>
        ← Driftline
      </Link>
      <h1 className="text-xl font-semibold text-text-primary">Terms of service</h1>
      <p className="text-sm text-text-muted">
        Driftline is a portfolio project, not a commercial product. Use it to see how a local-first, retention-limited
        chat architecture works end to end. Don&rsquo;t rely on it for anything you can&rsquo;t afford to lose — the whole
        point of this app is that the server doesn&rsquo;t keep your messages for you.
      </p>
      <Link href="/privacy" className={linkClass}>
        What we store and for how long
      </Link>
    </main>
  );
}
