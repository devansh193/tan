import { defineConfig } from "vitest/config";

// Unit tests run without a database. Required env vars are stubbed here so the
// config module validates successfully on import.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      BETTER_AUTH_SECRET: "01234567890123456789012345678901",
      BETTER_AUTH_URL: "http://localhost:3000",
      BASE_URL: "http://localhost:3000",
    },
  },
});
