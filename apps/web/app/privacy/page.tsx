import Link from "next/link";

import { RetentionTable } from "../../components/retention-table";
import { linkClass } from "../../lib/ui-classes";

export default function PublicPrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-6 py-8">
      <Link href="/" className={linkClass}>
        ← Driftline
      </Link>
      <h1 className="text-xl font-semibold text-text-primary">What we store, and for how long</h1>
      <p className="text-sm text-text-muted">
        This is the plain-English version of our retention model. Full technical contract available on request.
      </p>
      <RetentionTable />
      <Link href="/terms" className={linkClass}>
        Terms of service
      </Link>
    </main>
  );
}
