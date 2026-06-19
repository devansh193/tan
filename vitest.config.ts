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
      JWT_ACCESS_SECRET: "test-secret",
      BASE_URL: "http://localhost:3000",
    },
  },
});
