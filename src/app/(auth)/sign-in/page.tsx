import type { Metadata } from "next";

import { SignInForm } from "@/features/auth/components/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  sign_in_failed: "Sign-in was cancelled or failed. Please try again.",
  link_invalid: "That link is invalid or has expired. Please request a new one.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  // Next 16 made searchParams async.
  const params = await searchParams;

  const next = typeof params.next === "string" ? params.next : undefined;
  const errorKey = typeof params.error === "string" ? params.error : undefined;

  // Look the message up from a fixed table rather than rendering the query
  // string, so a crafted ?error= cannot inject arbitrary text into the page.
  const initialError = errorKey ? ERROR_MESSAGES[errorKey] : undefined;

  return <SignInForm next={next} initialError={initialError} />;
}
