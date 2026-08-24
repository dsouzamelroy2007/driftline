/**
 * Design tokens transcribed from docs/UI_DIRECTION.md §5.
 * Source of truth for both the Tailwind preset here (web) and the NativeWind
 * preset that will consume the same values in Phase 10 (mobile).
 */

export const colorTokens = {
  light: {
    bgBase: "#FAFAF9",
    bgSurface: "#FFFFFF",
    bgSurfaceRaised: "#F1F1EF",
    accentPrimary: "#2E5F73",
    accentRetention: "#B8763E",
    textPrimary: "#1B1E22",
    textMuted: "#6B7078",
    statusOnline: "#3E9469",
    statusError: "#C4483A",
  },
  dark: {
    bgBase: "#0F1216",
    bgSurface: "#171B21",
    bgSurfaceRaised: "#20252C",
    accentPrimary: "#5FA3BD",
    accentRetention: "#D9925A",
    textPrimary: "#EDEFF2",
    textMuted: "#8B919B",
    statusOnline: "#4FBF83",
    statusError: "#E0685A",
  },
} as const;

export const radiusTokens = {
  bubble: "18px",
  control: "10px",
} as const;

/** px scale: 13/15/17/20/24/30, one family (system-ui, fallback Inter). */
export const typeScaleTokens = {
  xs: "13px",
  sm: "15px",
  base: "17px",
  lg: "20px",
  xl: "24px",
  "2xl": "30px",
} as const;

export const fontFamilyTokens: { sans: string[] } = {
  sans: [
    "system-ui",
    "-apple-system",
    "Segoe UI",
    "Roboto",
    "Inter",
    "sans-serif",
  ],
};

export type ColorMode = keyof typeof colorTokens;
export type ColorToken = keyof (typeof colorTokens)["light"];
