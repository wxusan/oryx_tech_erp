import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Shell/Vercel-provided URLs are authoritative. `.env.local` may override
// `.env` for normal local development, but it must never redirect an explicit
// release, integration-test, or operator command to another database.
const explicitDatabaseUrl = process.env["DATABASE_URL"];
const explicitDirectUrl = process.env["DIRECT_URL"];

config({ path: ".env" });
config({ path: ".env.local", override: true });

if (explicitDatabaseUrl !== undefined) process.env["DATABASE_URL"] = explicitDatabaseUrl;
if (explicitDirectUrl !== undefined) process.env["DIRECT_URL"] = explicitDirectUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
  },
});
