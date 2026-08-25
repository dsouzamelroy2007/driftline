import Link from "next/link";

import { linkClass } from "../lib/ui-classes";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-text-primary">Page not found</h1>
      <Link href="/" className={linkClass}>
        Back to Driftline
      </Link>
    </main>
  );
}
