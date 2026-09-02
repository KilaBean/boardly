import { describe, expect, it } from "vitest";

import { buildInvitationEmail, escapeHtml } from "@/features/sharing/invitation-email";

/**
 * The invitation email.
 *
 * This is the one place in the product where user-chosen text is rendered as
 * HTML and delivered to somebody else's inbox, outside our own origin and any
 * framework escaping. That makes the escaping worth testing directly rather
 * than trusting.
 */

const BASE = {
  to: "invitee@example.com",
  inviterName: "Ada Lovelace",
  targetName: "Q3 Roadmap",
  target: "board" as const,
  role: "editor",
  url: "https://boardly.example/invite/abc123",
  expiresInDays: 7,
};

describe("escapeHtml", () => {
  it.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
    ["'", "&#39;"],
  ])("escapes %s", (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  it("escapes the ampersand first, so entities are not double-broken", () => {
    expect(escapeHtml("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});

describe("buildInvitationEmail", () => {
  it("names the sender, the board and what they can do", () => {
    const email = buildInvitationEmail(BASE);

    expect(email.subject).toContain("Ada Lovelace");
    expect(email.subject).toContain("Q3 Roadmap");
    expect(email.text).toContain("edit");
    expect(email.text).toContain(BASE.url);
  });

  it("addresses the invitee", () => {
    expect(buildInvitationEmail(BASE).to).toBe("invitee@example.com");
  });

  it("states the terms that actually apply", () => {
    // These three claims are enforced in SQL; the email must not overstate them.
    const { text } = buildInvitationEmail(BASE);
    expect(text).toContain("once");
    expect(text).toContain("only for this address");
    expect(text).toContain("7 days");
  });

  it("puts the link in the plain-text part too", () => {
    // Plenty of people read mail with images and HTML off; a button-only email
    // would be a dead end for them.
    expect(buildInvitationEmail(BASE).text).toContain(BASE.url);
  });

  it("describes a viewer invitation as viewing", () => {
    expect(buildInvitationEmail({ ...BASE, role: "viewer" }).text).toContain("view");
  });

  it("works without a target name", () => {
    const email = buildInvitationEmail({ ...BASE, targetName: null });
    expect(email.subject).toContain("Ada Lovelace");
    expect(email.text).toContain("a board");
  });

  it("says workspace for a workspace invitation", () => {
    const email = buildInvitationEmail({
      ...BASE,
      target: "workspace",
      targetName: "Acme",
      role: "admin",
    });
    expect(email.text).toContain("the workspace");
    expect(email.text).toContain("administer");
  });

  describe("injection", () => {
    it("escapes a board name containing markup", () => {
      const email = buildInvitationEmail({
        ...BASE,
        targetName: '<img src=x onerror="alert(1)">',
      });

      // The text may still read "onerror=" — escaped, it is inert prose. What
      // must not survive is a real tag or a real quoted attribute.
      expect(email.html).not.toContain("<img");
      expect(email.html).not.toContain('onerror="');
      expect(email.html).toContain("&lt;img");
    });

    it("escapes an inviter display name containing markup", () => {
      const email = buildInvitationEmail({
        ...BASE,
        inviterName: "</p><script>alert(1)</script>",
      });

      expect(email.html).not.toContain("<script>");
      expect(email.html).toContain("&lt;script&gt;");
    });

    it("escapes quotes in the url so the href cannot be broken out of", () => {
      const email = buildInvitationEmail({
        ...BASE,
        url: 'https://boardly.example/invite/x" onmouseover="alert(1)',
      });

      expect(email.html).not.toContain('" onmouseover="');
      expect(email.html).toContain("&quot;");
    });
  });
});
