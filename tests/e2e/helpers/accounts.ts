/**
 * Fixed accounts for authenticated end-to-end tests.
 *
 * `.test` is a reserved TLD (RFC 2606) that can never resolve, so these
 * addresses cannot accidentally email a real person if the suite is ever
 * pointed at a stack with a mail provider configured.
 *
 * The password is shared and hard-coded on purpose: it protects nothing, it
 * exists only in a local disposable database, and hiding it would imply a
 * secret that needs managing.
 */
export const TEST_PASSWORD = "boardly-e2e-password-2026";

export const ACCOUNTS = {
  /** Owns the seeded workspace and boards. */
  owner: {
    email: "owner@boardly.test",
    displayName: "Olivia Owner",
  },
  /** Ordinary member of the seeded workspace. */
  collaborator: {
    email: "collaborator@boardly.test",
    displayName: "Casey Collaborator",
  },
  /** Belongs to no shared workspace. Used to prove isolation through the UI. */
  outsider: {
    email: "outsider@boardly.test",
    displayName: "Oscar Outsider",
  },
  /**
   * Dedicated to the sign-out test.
   *
   * `supabase.auth.signOut()` defaults to *global* scope, revoking every
   * refresh token the user holds. Signing out as a shared account would
   * therefore invalidate the cached sessions the other parallel workers are
   * using, failing unrelated tests. This account exists so that blast radius
   * is one test.
   */
  quitter: {
    email: "quitter@boardly.test",
    displayName: "Quinn Quitter",
  },
  /**
   * Dedicated to the password-recovery test.
   *
   * That flow ends by *changing* the password, which would invalidate
   * TEST_PASSWORD for any account it shared. Keeping it separate means the
   * cached sessions of the other accounts stay valid.
   */
  resetter: {
    email: "resetter@boardly.test",
    displayName: "Rory Resetter",
  },
} as const;

/** The password the recovery test switches to. */
export const RESET_PASSWORD = "boardly-e2e-reset-2026";

export type AccountKey = keyof typeof ACCOUNTS;

/** Where each account's signed-in browser state is cached between projects. */
export function storageStatePath(account: AccountKey): string {
  return `tests/e2e/.auth/${account}.json`;
}

/** Seeded workspace and board names, shared between setup and assertions. */
export const SEED = {
  workspace: { name: "Acme Design", slug: "acme-design-e2e" },
  sharedBoard: "Team Roadmap",
  privateBoard: "Owner Only Notes",
} as const;
