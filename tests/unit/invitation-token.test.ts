import { describe, expect, it } from "vitest";

import {
  generateInvitationToken,
  hashInvitationToken,
  invitationTokenMatches,
  isInvitationExpired,
} from "@/lib/invitations/token";

describe("generateInvitationToken", () => {
  it("never returns the same token twice", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      seen.add(generateInvitationToken().token);
    }
    expect(seen.size).toBe(200);
  });

  it("produces a url-safe token with no padding", () => {
    const { token } = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a hash that is not the token itself", () => {
    // The whole security property: a database dump must not contain anything
    // replayable as an invitation link.
    const { token, tokenHash } = generateInvitationToken();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a hash the database CHECK constraint accepts", () => {
    // invitations_token_hash_length requires 32..128 characters.
    const { tokenHash } = generateInvitationToken();
    expect(tokenHash.length).toBeGreaterThanOrEqual(32);
    expect(tokenHash.length).toBeLessThanOrEqual(128);
  });

  it("expires in the future, seven days out by default", () => {
    const { expiresAt } = generateInvitationToken();
    const days = (expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});

describe("hashInvitationToken", () => {
  it("is deterministic", () => {
    expect(hashInvitationToken("abc")).toBe(hashInvitationToken("abc"));
  });

  it("differs for different tokens", () => {
    expect(hashInvitationToken("abc")).not.toBe(hashInvitationToken("abd"));
  });
});

describe("invitationTokenMatches", () => {
  it("accepts the correct token", () => {
    const { token, tokenHash } = generateInvitationToken();
    expect(invitationTokenMatches(token, tokenHash)).toBe(true);
  });

  it("rejects a wrong token", () => {
    const { tokenHash } = generateInvitationToken();
    const other = generateInvitationToken();
    expect(invitationTokenMatches(other.token, tokenHash)).toBe(false);
  });

  it("rejects a malformed stored hash without throwing", () => {
    const { token } = generateInvitationToken();
    expect(invitationTokenMatches(token, "")).toBe(false);
    expect(invitationTokenMatches(token, "not-hex")).toBe(false);
    expect(invitationTokenMatches(token, "abcd")).toBe(false);
  });
});

describe("isInvitationExpired", () => {
  const now = new Date("2026-08-24T12:00:00Z");

  it("treats a future expiry as valid", () => {
    expect(isInvitationExpired("2026-08-25T12:00:00Z", now)).toBe(false);
  });

  it("treats a past expiry as expired", () => {
    expect(isInvitationExpired("2026-08-23T12:00:00Z", now)).toBe(true);
  });

  it("treats the exact expiry instant as expired", () => {
    expect(isInvitationExpired(now, now)).toBe(true);
  });
});
