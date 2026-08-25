import { baseConfig } from "@driftline/eslint-config";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  ...baseConfig,
  {
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  { ignores: ["next-env.d.ts"] },
];
