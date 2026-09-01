import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adminClient } from "../e2e/helpers/seed";

/**
 * The guard that stops E2E seeding from running against a real project.
 *
 * `createConfirmedUser` deletes and recreates accounts, and `deleteUserByEmail`
 * removes the workspaces they own. Pointed at a hosted Supabase, that would
 * destroy production data — so the seed helper refuses any non-local URL.
 *
 * This is documented in docs/supabase-setup.md as a safety guarantee, which
 * makes it something to verify rather than assert.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  delete process.env.ALLOW_REMOTE_E2E_SEED;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("refuses to seed anything that is not local", () => {
  it.each([
    ["https://abcdefgh.supabase.co", "a hosted project"],
    ["https://boardly.example.com", "a custom domain"],
    ["http://192.168.1.50:54321", "another machine on the LAN"],
    ["http://127.0.0.1.evil.com", "a lookalike host"],
    ["http://localhost.evil.com:54321", "a localhost-prefixed domain"],
  ])("refuses %s (%s)", (url) => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    expect(() => adminClient()).toThrow(/Refusing to seed/i);
  });
});

describe("allows a genuinely local stack", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://127.0.0.1",
    "http://localhost",
  ])("allows %s", (url) => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    expect(() => adminClient()).not.toThrow();
  });
});

describe("the escape hatch is explicit", () => {
  it("still allows a remote URL when deliberately overridden", () => {
    // Present so a disposable staging project can be seeded on purpose; it has
    // to be typed out, which is the point.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://disposable.supabase.co";
    process.env.ALLOW_REMOTE_E2E_SEED = "1";
    expect(() => adminClient()).not.toThrow();
  });

  it("is not triggered by a merely truthy value", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://production.supabase.co";
    process.env.ALLOW_REMOTE_E2E_SEED = "true";
    expect(() => adminClient()).toThrow(/Refusing to seed/i);
  });
});

describe("missing configuration fails loudly", () => {
  it("names the variable rather than failing obscurely later", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => adminClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
