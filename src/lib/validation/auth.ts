import { z } from "zod";

import { displayNameSchema, emailSchema } from "./schemas";

/**
 * Credential schemas.
 *
 * These run on the client (React Hook Form) *and* again inside every server
 * action. The client copy is a convenience for fast feedback; the server copy
 * is the one that matters, because a form is trivially bypassed.
 */

/**
 * Minimum length only.
 *
 * Deliberately no character-class rules ("must contain a symbol"): they push
 * people toward predictable substitutions and shorter passwords, and NIST
 * SP 800-63B recommends against composition rules. Length is what helps.
 * Supabase enforces its own project-level minimum as a second gate.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters");

export const signInSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: an existing account may predate the current policy,
  // and rejecting it here would lock the user out of their own sign-in form.
  password: z.string().min(1, "Password is required"),
});

export const signUpSchema = z
  .object({
    displayName: displayNameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
