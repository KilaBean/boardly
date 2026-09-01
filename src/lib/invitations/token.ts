import "server-only";

import { generateToken, hashToken, tokenMatches } from "@/lib/tokens/secure-token";

/**
 * Invitation tokens.
 *
 * The cryptography lives in `@/lib/tokens/secure-token`, shared with share
 * links. This module adds the invitation-specific part: an expiry.
 *
 * An invitation is a bearer credential that grants workspace or board access
 * to whoever holds it, which is why only its hash is stored — see the shared
 * module for the reasoning.
 */

export const INVITATION_TTL_DAYS = 7;

export type GeneratedInvitationToken = {
  /** Send this to the invitee. Never persist it. */
  token: string;
  /** Store this. */
  tokenHash: string;
  expiresAt: Date;
};

export function generateInvitationToken(
  ttlDays: number = INVITATION_TTL_DAYS,
): GeneratedInvitationToken {
  const { token, tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  return { token, tokenHash, expiresAt };
}

export function hashInvitationToken(token: string): string {
  return hashToken(token);
}

export function invitationTokenMatches(token: string, expectedHash: string): boolean {
  return tokenMatches(token, expectedHash);
}

/** Expiry is inclusive: an invitation is dead at the instant it expires. */
export function isInvitationExpired(expiresAt: string | Date, now: Date = new Date()): boolean {
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return expiry.getTime() <= now.getTime();
}
