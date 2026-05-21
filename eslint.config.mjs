import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.commonjs,
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "no-empty": ["warn", { "allowEmptyCatch": true }],
      "no-undef": "error",
      "no-case-declarations": "off",
      "no-irregular-whitespace": "off",
      "no-constant-condition": ["error", { "checkLoops": false }]
    }
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { sourceType: "module" }
  },
  {
    ignores: ["node_modules/", "baileys_auth/", "logs/", "data/", "config/*.db", "config/*.db-*", "*.log"]
  }
]);
