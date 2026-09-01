import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Bearer-token primitives shared by invitations and share links.
 *
 * Both are credentials that grant access to whoever holds them, so both follow
 * the same rule: the database stores only a SHA-256 hash, and the raw value
 * exists exactly once — in the emailed invitation or the shared URL. A dump of
 * the table therefore yields nothing replayable.
 */

/** 256 bits of entropy, url-safe and unpadded. */
const TOKEN_BYTES = 32;

export type GeneratedToken = {
  /** Give this to the recipient. Never persist it. */
  token: string;
  /** Store this. */
  tokenHash: string;
};

export function generateToken(): GeneratedToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of a raw token against a stored hash.
 *
 * Hash lookups normally go through an indexed equality query, but wherever a
 * comparison happens in application code it must not leak timing.
 */
export function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");

  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash, "hex");
  } catch {
    return false;
  }

  if (actual.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(actual, expected);
}

/** Shape check for a value arriving from a URL, before it touches the database. */
export function isPlausibleToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,200}$/.test(value);
}
