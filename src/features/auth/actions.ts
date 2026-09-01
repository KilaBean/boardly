"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { safeRedirectPath } from "@/lib/auth/redirect";
import { clientEnv } from "@/lib/env/client";
import { createClient } from "@/lib/supabase/server";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";

/**
 * Authentication server actions.
 *
 * Every action re-validates its input with the same Zod schema the form uses.
 * The client-side parse is for fast feedback; a server action is a public HTTP
 * endpoint, so it cannot trust anything the form claims to have checked.
 *
 * ── On error messages ──────────────────────────────────────────────────────
 * Sign-in and password-reset responses are deliberately uniform. Telling a
 * visitor "no account with that email" turns the form into an account
 * enumeration oracle, which is the first step of a credential-stuffing or
 * targeted-phishing campaign. We say the same thing whether the account
 * exists or the password was wrong.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type AuthActionResult = { error: string } | { success: true; message?: string };

const GENERIC_CREDENTIALS_ERROR = "Incorrect email or password.";
const GENERIC_FAILURE = "Something went wrong. Please try again.";

/** First validation issue, or a generic fallback. */
function firstIssue(issues: { message: string }[]): string {
  return issues[0]?.message ?? GENERIC_FAILURE;
}

export async function signInAction(raw: unknown, next?: string): Promise<AuthActionResult> {
  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: firstIssue(parsed.error.issues) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Supabase distinguishes "invalid credentials" from "email not confirmed".
    // The latter is safe to surface: the visitor already proved they know the
    // password, so it reveals nothing to an outsider.
    if (error.code === "email_not_confirmed") {
      return { error: "Please confirm your email address before signing in." };
    }
    return { error: GENERIC_CREDENTIALS_ERROR };
  }

  revalidatePath("/", "layout");
  redirect(safeRedirectPath(next));
}

export async function signUpAction(raw: unknown): Promise<AuthActionResult> {
  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: firstIssue(parsed.error.issues) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Consumed by the on_auth_user_created trigger to seed profiles.display_name.
      data: { full_name: parsed.data.displayName },
      emailRedirectTo: `${clientEnv.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });

  if (error) {
    if (error.code === "over_email_send_rate_limit") {
      return { error: "Too many attempts. Please wait a moment and try again." };
    }
    if (error.code === "weak_password") {
      return { error: "Please choose a stronger password." };
    }
    return { error: GENERIC_FAILURE };
  }

  // With email confirmation enabled, Supabase returns a user with no identities
  // when the address is already registered, rather than erroring. Surfacing
  // that difference would leak which addresses have accounts, so both paths
  // produce the same message.
  const needsConfirmation = !data.session;
  if (needsConfirmation) {
    return {
      success: true,
      message: "Check your email for a confirmation link to finish signing up.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/sign-in");
}

export async function requestPasswordResetAction(raw: unknown): Promise<AuthActionResult> {
  const parsed = forgotPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: firstIssue(parsed.error.issues) };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${clientEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
  });

  // Intentionally ignores the result. Reporting failure would reveal whether
  // the address has an account; the user is told an email is on its way
  // either way.
  return {
    success: true,
    message: "If an account exists for that address, a reset link is on its way.",
  };
}

export async function updatePasswordAction(raw: unknown): Promise<AuthActionResult> {
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: firstIssue(parsed.error.issues) };
  }

  const supabase = await createClient();

  // Reaching this action requires an active session, which the recovery link
  // established. Without one, Supabase rejects the update — so an attacker
  // with only the reset form cannot change anybody's password.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Your reset link has expired. Please request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") {
      return { error: "Please choose a password you have not used before." };
    }
    return { error: GENERIC_FAILURE };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signInWithGoogleAction(next?: string): Promise<AuthActionResult> {
  const supabase = await createClient();
  const target = safeRedirectPath(next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${clientEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(target)}`,
    },
  });

  if (error || !data.url) {
    return { error: "Could not start Google sign-in. Please try again." };
  }

  redirect(data.url);
}
