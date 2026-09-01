/**
 * Reads mail out of the local Mailpit catcher.
 *
 * `supabase start` runs Mailpit, which accepts every outgoing email and sends
 * none of them. That makes password recovery testable end to end without a
 * mail provider or a real inbox.
 */

const MAILPIT = "http://127.0.0.1:54324";

type MailpitSummary = { ID: string; To: { Address: string }[] };
type MailpitMessage = { Text: string; HTML: string };

/** Deletes every stored message so a test starts from a known inbox. */
export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
}

/**
 * Waits for a message addressed to `recipient` and returns its body.
 *
 * Polls rather than assuming immediate delivery: the email is sent
 * asynchronously after the server action returns.
 */
export async function waitForEmail(recipient: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${MAILPIT}/api/v1/messages`);
    if (response.ok) {
      const { messages } = (await response.json()) as { messages: MailpitSummary[] };
      const match = messages.find((message) =>
        message.To.some((to) => to.Address.toLowerCase() === recipient.toLowerCase()),
      );

      if (match) {
        const detail = await fetch(`${MAILPIT}/api/v1/message/${match.ID}`);
        const body = (await detail.json()) as MailpitMessage;
        return `${body.Text ?? ""}\n${body.HTML ?? ""}`;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`No email arrived for ${recipient} within ${timeoutMs}ms`);
}

/** Pulls the first http(s) link out of an email body. */
export function firstLink(body: string): string {
  // Supabase templates HTML-escape the query string, so unescape before use.
  const unescaped = body.replace(/&amp;/g, "&");
  const match = unescaped.match(/https?:\/\/[^\s"'<>)]+/);
  if (!match) throw new Error("No link found in email body");
  return match[0];
}
