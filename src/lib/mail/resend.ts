/**
 * Resend transport.
 *
 * A direct `fetch` rather than the `resend` SDK: the API is a single POST with
 * a bearer token, and the project does not add dependencies without a reason.
 * It also keeps this testable by passing a fake `fetch` instead of mocking a
 * module.
 *
 * Deliberately free of environment and Next.js imports so it can be exercised
 * in Node with no server, no secrets and no network.
 */

const ENDPOINT = "https://api.resend.com/emails";

/** How long to wait before giving up. An invite must not hang on the mailer. */
const TIMEOUT_MS = 10_000;

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type SendResult =
  { delivered: true; id: string | null } | { delivered: false; reason: string };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Sends one email.
 *
 * Never throws. Delivery is best-effort at every call site — an invitation that
 * exists but was not emailed is recoverable by copying the link, whereas an
 * exception here would lose the invitation itself.
 */
export async function sendViaResend(
  { apiKey, from }: { apiKey: string; from: string },
  email: OutboundEmail,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Resend puts a human-readable reason in the body; the status alone does
      // not distinguish "domain not verified" from "bad key", and that is
      // exactly what someone reads the log for.
      const detail = await response.text().catch(() => "");
      return {
        delivered: false,
        reason: `resend responded ${response.status}: ${detail.slice(0, 200)}`,
      };
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { delivered: true, id: body?.id ?? null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return { delivered: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}
