"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "../lib/auth-context";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-muted" role="status">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}

// For auth screens (login/register/welcome) — bounces an already-signed-in user into the app.
export function RequireGuest({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/chat");
  }, [status, router]);

  if (status === "authenticated") return null;

  return <>{children}</>;
}
