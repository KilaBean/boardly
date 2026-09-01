import { describe, expect, it } from "vitest";

import {
  forgotPasswordSchema,
  passwordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";

describe("passwordSchema", () => {
  it("requires at least 8 characters", () => {
    expect(passwordSchema.safeParse("short12").success).toBe(false);
    expect(passwordSchema.safeParse("longenough1").success).toBe(true);
  });

  it("accepts a long passphrase without composition rules", () => {
    // No "must contain a symbol" rule by design — length is what matters.
    expect(passwordSchema.safeParse("correct horse battery staple").success).toBe(true);
  });

  it("rejects a password beyond the bcrypt input limit", () => {
    expect(passwordSchema.safeParse("a".repeat(73)).success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("accepts valid credentials", () => {
    const result = signInSchema.safeParse({ email: "a@b.com", password: "anything" });
    expect(result.success).toBe(true);
  });

  it("does not apply the password policy to sign-in", () => {
    // An account created before the current policy must still be able to sign
    // in; enforcing length here would lock the user out of their own form.
    expect(signInSchema.safeParse({ email: "a@b.com", password: "old" }).success).toBe(true);
  });

  it("requires a password to be present", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });

  it("normalizes the email", () => {
    const result = signInSchema.safeParse({ email: " A@B.COM ", password: "x" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("a@b.com");
  });
});

describe("signUpSchema", () => {
  const valid = {
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    password: "longenough1",
    confirmPassword: "longenough1",
  };

  it("accepts a complete registration", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects mismatched passwords and points at the confirm field", () => {
    const result = signUpSchema.safeParse({ ...valid, confirmPassword: "different1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["confirmPassword"]);
    }
  });

  it("rejects a weak password", () => {
    expect(
      signUpSchema.safeParse({ ...valid, password: "abc", confirmPassword: "abc" }).success,
    ).toBe(false);
  });

  it("rejects a blank display name", () => {
    expect(signUpSchema.safeParse({ ...valid, displayName: "   " }).success).toBe(false);
  });
});

describe("forgotPasswordSchema", () => {
  it("accepts a valid address", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });

  it("rejects an invalid address", () => {
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("requires the confirmation to match", () => {
    expect(
      resetPasswordSchema.safeParse({ password: "longenough1", confirmPassword: "longenough2" })
        .success,
    ).toBe(false);
  });

  it("accepts a matching pair", () => {
    expect(
      resetPasswordSchema.safeParse({ password: "longenough1", confirmPassword: "longenough1" })
        .success,
    ).toBe(true);
  });
});
