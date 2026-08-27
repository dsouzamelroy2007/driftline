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
    // Deepened from #2E5F73 in Phase 6 part 6's UI polish pass — same hue family, more chroma, so
    // it reads as a deliberate color rather than washed-out slate. docs/UI_DIRECTION.md §5.
    accentPrimary: "#146B82",
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
    // Deepened from #5FA3BD — see the light-mode note above.
    accentPrimary: "#52B8D9",
    accentRetention: "#D9925A",
    textPrimary: "#EDEFF2",
    textMuted: "#8B919B",
    statusOnline: "#4FBF83",
    statusError: "#E0685A",
  },
} as const;

// Per-contact avatar fill colors (Phase 6 part 6, docs/UI_DIRECTION.md §5) — six hues, chroma- and
// lightness-matched to each other, so every fallback initial-letter avatar isn't the same flat
// accent-primary circle (Telegram's biggest single win for scanning a conversation list).
// Deliberately skips the amber/orange band `accentRetention` occupies, so a colored avatar is never
// mistaken for a retention/expiry cue. Hashed onto a stable per-contact seed by the caller
// (apps/web/components/avatar.tsx) — this array is just the palette, not the hashing logic.
export const avatarPaletteTokens = {
  light: ["#146B82", "#5457A6", "#8B4E82", "#A2455F", "#3E7A5B", "#47607A"],
  dark: ["#52B8D9", "#8385D6", "#B87CAE", "#D9748F", "#6BAE87", "#7A97B3"],
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
