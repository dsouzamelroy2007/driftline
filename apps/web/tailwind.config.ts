import { tailwindPreset } from "@driftline/ui-tokens";
import type { Config } from "tailwindcss";

const config: Config = {
  presets: [tailwindPreset],
  // Was just "./app/**" — components/avatar.tsx's bg-avatar-* classes never appeared literally
  // anywhere under app/, so Tailwind's scanner never generated them at all (a real, silent bug:
  // every fallback avatar rendered with no background color). lib/ui-classes.ts's classes only ever
  // "worked" because the same literal strings happen to also appear directly in app/**/*.tsx files —
  // a coincidence, not something to rely on going forward.
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
};

export default config;
