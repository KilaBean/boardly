import { describe, expect, it } from "vitest";

import {
  generateToken,
  hashToken,
  isPlausibleToken,
  tokenMatches,
} from "@/lib/tokens/secure-token";

/**
 * Shared by invitations and share links. Both are bearer credentials, so the
 * property that matters is the same for both: what lands in the database must
 * not be replayable as a link.
 */

describe("generateToken", () => {
  it("never repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateToken().token);
    expect(seen.size).toBe(500);
  });

  it("is url-safe and unpadded", () => {
    // Tokens travel in a path segment, so "+", "/" and "=" would need escaping.
    for (let i = 0; i < 20; i += 1) {
      expect(generateToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("stores a hash, not the token", () => {
    const { token, tokenHash } = generateToken();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
  });

  it("produces a hash the database CHECK constraints accept", () => {
    // Both invitations_token_hash_length and boards_share_token_hash_length
    // require 32..128 characters.
    const { tokenHash } = generateToken();
    expect(tokenHash.length).toBeGreaterThanOrEqual(32);
    expect(tokenHash.length).toBeLessThanOrEqual(128);
  });
});

describe("hashToken", () => {
  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("differs for a one-character change", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("tokenMatches", () => {
  it("accepts the right token", () => {
    const { token, tokenHash } = generateToken();
    expect(tokenMatches(token, tokenHash)).toBe(true);
  });

  it("rejects a different token", () => {
    const { tokenHash } = generateToken();
    expect(tokenMatches(generateToken().token, tokenHash)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", () => {
    const { token } = generateToken();
    for (const bad of ["", "zz", "not-hex", "abcd"]) {
      expect(tokenMatches(token, bad)).toBe(false);
    }
  });
});

describe("isPlausibleToken", () => {
  it("accepts a generated token", () => {
    expect(isPlausibleToken(generateToken().token)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["short", "too short"],
    ["a".repeat(201), "too long"],
    ["has spaces in it aaaaaaaaaaaa", "spaces"],
    ["../../etc/passwd", "path traversal"],
    ["'; drop table boards;--", "sql-ish"],
    ["token+with/base64=chars", "non url-safe"],
    ["<script>alert(1)</script>", "markup"],
  ])("rejects %j (%s)", (value) => {
    expect(isPlausibleToken(value)).toBe(false);
  });

  it.each([[null], [undefined], [123], [{}], [[]]])("rejects the non-string %j", (value) => {
    expect(isPlausibleToken(value)).toBe(false);
  });
});
