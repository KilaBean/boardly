import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Two projects, because the suites need genuinely different runtimes:
 *
 * - `unit` renders React, so it needs jsdom and the DOM setup file.
 * - `integration` boots Postgres (PGlite) to exercise the real migrations and
 *   RLS policies. It must run in Node — loading the DOM setup there fails.
 */
export default defineConfig({
  plugins: [react()],
  // Vite 8 resolves tsconfig `paths` natively, so no plugin is needed for "@/*".
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws unless it is resolved through the react-server
      // condition. Tests import server modules directly, so stub it out. The
      // guard still applies to `next build`, which is what actually protects
      // the service-role key.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/app/**/layout.tsx"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup.dom.ts"],
          include: ["tests/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          globals: true,
          include: ["tests/integration/**/*.test.ts"],
          // Booting a fresh Postgres per suite is not instant.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
