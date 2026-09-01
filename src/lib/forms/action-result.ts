/**
 * Uniform result shape for server actions.
 *
 * Actions return failures as values rather than throwing, so a client can
 * render a message without an error boundary tearing down the form. Genuine
 * bugs still throw and are handled by the nearest `error.tsx`.
 */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

export function ok(): ActionResult<void>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | void> {
  return { ok: true, data: data as T };
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

/** Postgres unique-violation SQLSTATE, surfaced by PostgREST as `code`. */
export const UNIQUE_VIOLATION = "23505";

/** Message shown when an unexpected database error occurs. */
export const GENERIC_ERROR = "Something went wrong. Please try again.";
