/**
 * `redirect()` and `notFound()` work by throwing a tagged error that Next
 * catches to perform the navigation. A `try/catch` around a server action call
 * will therefore swallow the navigation and leave the user staring at a form
 * that appears to have done nothing.
 *
 * Call this first in any catch block wrapping a server action.
 */
export function rethrowIfNavigation(error: unknown): void {
  if (typeof error !== "object" || error === null || !("digest" in error)) return;

  const { digest } = error as { digest?: unknown };
  if (typeof digest !== "string") return;

  if (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND") {
    throw error;
  }
}

export const UNEXPECTED_ERROR = "Something went wrong. Please try again.";
