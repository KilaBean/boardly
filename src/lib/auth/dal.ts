import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";

import { signInUrlFor } from "./redirect";

/**
 * Data Access Layer for identity.
 *
 * `src/proxy.ts` performs an *optimistic* check — it only looks at cookies, so
 * it is fast enough to run on every request but is not proof of anything. This
 * module is the real check, and it lives next to the data as Next.js
 * recommends. Server components, server actions and route handlers should all
 * establish identity through here rather than reaching for Supabase directly.
 *
 * Each function is wrapped in React's `cache`, so calling `getUser()` from a
 * layout and three components during one render performs a single verification
 * rather than four.
 */

/**
 * The authenticated user, or null.
 *
 * Uses `getUser()`, never `getSession()`. `getSession()` reads the cookie and
 * trusts it; `getUser()` revalidates the token with the Supabase Auth server.
 * On the server the cookie is attacker-supplied input, so the difference is
 * the difference between a real check and a decorative one.
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user;
});

/**
 * The authenticated user, or a redirect to sign-in.
 *
 * `currentPath` is round-tripped through `safeRedirectPath` inside
 * `signInUrlFor`, so a hostile value cannot turn this into an open redirect.
 */
export const requireUser = cache(async (currentPath?: string) => {
  const user = await getUser();
  if (!user) {
    redirect(currentPath ? signInUrlFor(currentPath) : "/sign-in");
  }
  return user;
});

/** The signed-in user's profile row, or null when unauthenticated. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return null;
  return data;
});

/**
 * A minimal, non-sensitive view of the current user for client components.
 *
 * Passing the raw Supabase user object into the client tree would ship
 * internal auth metadata (identities, app_metadata, raw provider payloads)
 * into the browser. Send a DTO with only what the UI renders.
 */
export type CurrentUser = {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const user = await getUser();
  if (!user) return null;

  const profile = await getProfile();

  return {
    id: user.id,
    email: user.email ?? null,
    displayName: profile?.display_name ?? user.email?.split("@")[0] ?? "Member",
    avatarUrl: profile?.avatar_url ?? null,
  };
});
