import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Test configuration (PRD #9 §4).
 *
 * Two projects, because they need different things: unit tests are pure and run
 * anywhere, while integration and API tests need a real PostgreSQL database and
 * must never mock the authorisation they exist to verify (PRD #9 §223).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Integration tests share one database; running files in parallel would let
    // them see each other's writes.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    server: {
      deps: {
        // next-auth imports `next/server` without an extension, which Node's
        // ESM resolver refuses; letting Vite resolve it makes the auth modules
        // importable from a test.
        inline: ["next-auth"],
      },
    },
  },
});
