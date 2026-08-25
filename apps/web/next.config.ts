import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@driftline/ui-tokens"],
  // Required for @driftline/local-store's browser backend (sqlocal, OPFS-backed SQLite Wasm) to
  // use the fast OPFS SyncAccessHandle path — see docs/ADR/0006-local-store-engine.md. Applies
  // site-wide since the store is meant to be usable from any page once Phase 5 wires it up.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
