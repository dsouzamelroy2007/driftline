import type { Config } from "tailwindcss";

import { radiusTokens, typeScaleTokens, fontFamilyTokens } from "./tokens";

/**
 * Shared Tailwind preset. Colors resolve through CSS custom properties
 * (declared per light/dark scheme in the consuming app's global stylesheet)
 * so a single class like `bg-bg-surface` works in both themes.
 */
export const tailwindPreset = {
  theme: {
    extend: {
      colors: {
        "bg-base": "var(--color-bg-base)",
        "bg-surface": "var(--color-bg-surface)",
        "bg-surface-raised": "var(--color-bg-surface-raised)",
        "accent-primary": "var(--color-accent-primary)",
        "accent-retention": "var(--color-accent-retention)",
        "text-primary": "var(--color-text-primary)",
        "text-muted": "var(--color-text-muted)",
        "status-online": "var(--color-status-online)",
        "status-error": "var(--color-status-error)",
        "avatar-1": "var(--color-avatar-1)",
        "avatar-2": "var(--color-avatar-2)",
        "avatar-3": "var(--color-avatar-3)",
        "avatar-4": "var(--color-avatar-4)",
        "avatar-5": "var(--color-avatar-5)",
        "avatar-6": "var(--color-avatar-6)",
      },
      borderRadius: {
        bubble: radiusTokens.bubble,
        control: radiusTokens.control,
      },
      fontSize: typeScaleTokens,
      fontFamily: fontFamilyTokens,
    },
  },
} satisfies Pick<Config, "theme">;
