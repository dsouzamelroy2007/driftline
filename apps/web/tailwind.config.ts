import { tailwindPreset } from "@driftline/ui-tokens";
import type { Config } from "tailwindcss";

const config: Config = {
  presets: [tailwindPreset],
  content: ["./app/**/*.{ts,tsx}"],
};

export default config;
