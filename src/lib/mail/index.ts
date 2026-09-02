import "server-only";

import { serverEnv } from "@/lib/env/server";

import { sendViaResend, type OutboundEmail, type SendResult } from "./resend";

export type { OutboundEmail, SendResult };

/**
 * Outbound email.
 *
 * One port, one adapter. Everything that sends mail goes through `sendEmail`
 * and never imports a provider, so replacing Resend is one file rather than a
 * search across features.
 *
 * Mail is optional. With no provider configured this reports `delivered:
 * false` instead of throwing, and callers fall back to something the user can
 * still act on — for invitations, the copyable link. That keeps a local
 * checkout with no API key fully usable.
 */
export function isMailConfigured(): boolean {
  return Boolean(serverEnv.RESEND_API_KEY && serverEnv.MAIL_FROM);
}

export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  const apiKey = serverEnv.RESEND_API_KEY;
  const from = serverEnv.MAIL_FROM;

  if (!apiKey || !from) {
    return { delivered: false, reason: "mail is not configured" };
  }

  const result = await sendViaResend({ apiKey, from }, email);

  if (!result.delivered) {
    // Logged, not thrown: the caller has already done the durable work. The
    // address is included because "which invite failed" is the first question,
    // and it is data the operator already holds.
    console.error(`[mail] failed to send to ${email.to}: ${result.reason}`);
  }

  return result;
}
