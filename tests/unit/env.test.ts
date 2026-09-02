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

describe("mail configuration", () => {
  const withMail = {
    ...validServer,
    RESEND_API_KEY: "re_abc123",
    MAIL_FROM: "Boardly <invites@example.com>",
  };

  it("accepts a server with no mail configured at all", () => {
    // Mail is optional: a local checkout with no API key must still boot, and
    // invitations fall back to the copyable link.
    expect(serverEnvSchema.safeParse(validServer).success).toBe(true);
  });

  it("accepts both values together", () => {
    expect(serverEnvSchema.safeParse(withMail).success).toBe(true);
  });

  it.each([
    ["a key with no sender", { RESEND_API_KEY: "re_abc123" }],
    ["a sender with no key", { MAIL_FROM: "invites@example.com" }],
  ])("rejects %s", (_label, partial) => {
    // Half-configured is the dangerous state: it silently sends nothing while
    // looking configured. Failing at boot is the loud, correct outcome.
    expect(serverEnvSchema.safeParse({ ...validServer, ...partial }).success).toBe(false);
  });

  it("rejects a key that is not a Resend key", () => {
    expect(serverEnvSchema.safeParse({ ...withMail, RESEND_API_KEY: "sk_live_x" }).success).toBe(
      false,
    );
  });

  it.each(["invites@example.com", "Boardly <invites@example.com>"])(
    "accepts the sender %s",
    (from) => {
      expect(serverEnvSchema.safeParse({ ...withMail, MAIL_FROM: from }).success).toBe(true);
    },
  );

  it.each(["not-an-email", "Boardly <not-an-email>", ""])("rejects the sender %s", (from) => {
    expect(serverEnvSchema.safeParse({ ...withMail, MAIL_FROM: from }).success).toBe(false);
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
