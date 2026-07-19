import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src-tauri/target/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Milkdown command/plugin APIs intentionally expose payloads with
      // provider-defined shapes. Tighten these incrementally at the adapter
      // boundaries rather than blocking the initial lint baseline.
      "@typescript-eslint/no-explicit-any": "off",
      // These compiler-oriented rules reject intentional latest-value refs
      // and adapter patterns used by Milkdown. The conventional hooks rules
      // remain enabled, including dependency checking and rules-of-hooks.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/static-components": "off",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["vite.config.ts", "eslint.config.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
