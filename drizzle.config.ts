import { defineConfig } from "drizzle-kit";
import { env } from "./src/config/env";

// drizzle-kit reads this to generate/push migrations from the schema.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: env.DATABASE_URL },
  verbose: true,
  strict: true,
});
