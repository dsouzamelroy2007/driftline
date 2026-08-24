import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/** Shared flat ESLint config, extended by every app/package. */
export const baseConfig = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: ["dist/**", ".next/**", ".turbo/**", "node_modules/**"],
  },
);
