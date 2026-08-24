import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // bcryptjs (pure-JS bcrypt, deliberately CPU-heavy) can exceed the 5s default under the CPU
    // contention of a full `turbo run lint typecheck test build` across every package at once.
    testTimeout: 15000,
  },
});
