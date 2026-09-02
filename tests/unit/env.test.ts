import { describe, expect, it } from "vitest";

import { clientEnvSchema, formatEnvError, serverEnvSchema } from "@/lib/env/schema";

const validClient = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY: "pk_dev_abc",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

const validServer = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  LIVEBLOCKS_SECRET_KEY: "sk_dev_abc",
  NODE_ENV: "test",
};

describe("clientEnvSchema", () => {
  it("accepts a fully populated public environment", () => {
    expect(clientEnvSchema.safeParse(validClient).success).toBe(true);
  });

  it("rejects a non-URL Supabase URL", () => {
    const result = clientEnvSchema.safeParse({
      ...validClient,
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("treats the tldraw license key as optional", () => {
    // Absent is valid: localhost runs unlicensed. It is deployments that need
    // it, and a missing value there must fail visibly in tldraw rather than at
    // boot on a developer's machine.
    expect(clientEnvSchema.safeParse(validClient).success).toBe(true);
    expect(
      clientEnvSchema.safeParse({ ...validClient, NEXT_PUBLIC_TLDRAW_LICENSE_KEY: "tldraw-key" })
        .success,
    ).toBe(true);
  });

  it("rejects an empty tldraw license key", () => {
    // An empty string is a misconfiguration, not "unlicensed" — it usually
    // means the variable was added to the environment but never filled in.
    expect(
      clientEnvSchema.safeParse({ ...validClient, NEXT_PUBLIC_TLDRAW_LICENSE_KEY: "" }).success,
    ).toBe(false);
  });

  it.each(Object.keys(validClient))("rejects a missing %s", (key) => {
    const { [key]: _omitted, ...rest } = validClient as Record<string, string>;
    expect(clientEnvSchema.safeParse(rest).success).toBe(false);
  });
});

describe("serverEnvSchema", () => {
  it("accepts a fully populated server environment", () => {
    expect(serverEnvSchema.safeParse(validServer).success).toBe(true);
  });

  it("rejects a Liveblocks secret key that is not a secret key", () => {
    // Guards against pasting the public key into the secret slot, which would
    // make room authorization silently fail open at configuration time.
    const result = serverEnvSchema.safeParse({
      ...validServer,
      LIVEBLOCKS_SECRET_KEY: "pk_dev_abc",
    });
    expect(result.success).toBe(false);
  });

  it("defaults NODE_ENV to development when absent", () => {
    const { NODE_ENV: _omitted, ...rest } = validServer;
    const result = serverEnvSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe("development");
    }
  });
});

describe("formatEnvError", () => {
  it("names the offending variable without echoing its value", () => {
    const secret = "super-secret-value-that-must-not-leak";
    const result = serverEnvSchema.safeParse({
      ...validServer,
      LIVEBLOCKS_SECRET_KEY: secret,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const message = formatEnvError(result.error, "server");
    expect(message).toContain("LIVEBLOCKS_SECRET_KEY");
    expect(message).not.toContain(secret);
  });
});
