import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Type-aware linting so rules like no-floating-promises work — these catch the
// class of bug where a rejected promise is dropped instead of handled.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "drizzle", "*.config.ts", "*.config.mjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: "./tsconfig.eslint.json", tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Allow intentionally-unused args/vars prefixed with underscore.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Express handlers legitimately receive `any` from req.body etc.; the
      // Zod validation layer is where shapes are enforced.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  prettier,
);
