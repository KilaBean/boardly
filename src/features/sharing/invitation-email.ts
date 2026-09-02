import type { OutboundEmail } from "@/lib/mail";

/**
 * The invitation email.
 *
 * A pure function of its inputs — no environment, no client, no network — so
 * the wording and, more importantly, the escaping can be tested directly.
 */

export type InvitationEmailInput = {
  to: string;
  /** Display name of the person sending the invitation. User-controlled. */
  inviterName: string;
  /** Name of the board or workspace being shared. User-controlled. */
  targetName: string | null;
  target: "board" | "workspace";
  role: string;
  url: string;
  expiresInDays: number;
};

/**
 * Escapes text for HTML.
 *
 * Display names and board names are chosen by users and land in an email body
 * that other people open. Without this, naming a board `<img onerror=...>`
 * would put that markup into someone else's inbox.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "Can edit" / "Can view", rather than leaking the internal role name. */
function describeRole(role: string): string {
  switch (role) {
    case "editor":
      return "edit";
    case "viewer":
      return "view";
    case "admin":
      return "administer";
    default:
      return "access";
  }
}

export function buildInvitationEmail(input: InvitationEmailInput): OutboundEmail {
  const { inviterName, targetName, target, role, url, expiresInDays } = input;

  const what = targetName
    ? `${target === "board" ? "the board" : "the workspace"} “${targetName}”`
    : `a ${target}`;

  const subject = targetName
    ? `${inviterName} shared “${targetName}” with you on Boardly`
    : `${inviterName} invited you to Boardly`;

  const lead = `${inviterName} invited you to ${describeRole(role)} ${what} on Boardly.`;
  const expiry = `This link works once, only for this address, and expires in ${expiresInDays} days.`;

  const text = [lead, "", url, "", expiry].join("\n");

  // Inline styles and a table-free layout: mail clients strip <style> blocks,
  // and anything cleverer than this renders unpredictably across them.
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f6f6f7;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:28px;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">${escapeHtml(lead)}</p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:500;">Open the invitation</a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#52525b;">${escapeHtml(expiry)}</p>
      <p style="margin:0;font-size:12px;line-height:1.5;color:#71717a;word-break:break-all;">If the button does not work, paste this into your browser:<br />${escapeHtml(url)}</p>
    </div>
  </body>
</html>`;

  return { to: input.to, subject, text, html };
}
