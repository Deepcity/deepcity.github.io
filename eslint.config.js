import eslintPluginAstro from "eslint-plugin-astro";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  ...tseslint.configs.recommended,
  ...eslintPluginAstro.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  { rules: { "no-console": "error" } },
  {
    files: [
      "src/agent/**/*.ts",
      "scripts/blog-agent.ts",
      "tests/blog-agent.test.ts",
    ],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
  { ignores: ["dist/**", ".astro", "public/pagefind/**", ".tmp/**"] },
];
