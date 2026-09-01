import { defineConfig, devices } from "@playwright/test";

import { loadEnvLocal } from "./tests/e2e/helpers/env";

loadEnvLocal();

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * Authenticated tests need a real Supabase instance with an auth server. They
 * are enabled only when one is actually configured locally, so `npm run
 * test:e2e` still passes on a machine without Docker — it simply runs the
 * anonymous suite. Set `E2E_REQUIRE_AUTH=1` in CI to make their absence an
 * error rather than a silent skip.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const hasLocalSupabase = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl);

if (process.env.E2E_REQUIRE_AUTH === "1" && !hasLocalSupabase) {
  throw new Error(
    "E2E_REQUIRE_AUTH=1 but no local Supabase is configured. Run `supabase start` and " +
      "copy its keys into .env.local.",
  );
}

const authenticatedProjects = hasLocalSupabase
  ? [
      {
        name: "seed",
        testDir: "./tests/e2e/setup",
        testMatch: /seed\.setup\.ts/,
      },
      {
        name: "auth",
        testDir: "./tests/e2e/setup",
        testMatch: /auth\.setup\.ts/,
        dependencies: ["seed"],
      },
      {
        name: "authenticated",
        testDir: "./tests/e2e/authenticated",
        dependencies: ["auth"],
        use: {
          ...devices["Desktop Chrome"],
          // Files that need a different account override this with `test.use`.
          storageState: "tests/e2e/.auth/owner.json",
        },
      },
    ]
  : [];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "anonymous",
      testDir: "./tests/e2e",
      testIgnore: ["**/authenticated/**", "**/setup/**"],
      use: { ...devices["Desktop Chrome"] },
    },
    ...authenticatedProjects,
  ],
  // E2E always runs against a production build rather than the dev server.
  // The dev server emits HMR websocket traffic and dev-only 403s on /_next
  // assets, which make a "no console errors" assertion permanently red and
  // would train us to ignore it. Testing the built artifact is also what ships.
  webServer: {
    command: "npm run build && npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
