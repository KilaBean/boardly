/** Static product metadata. No secrets, safe on the client. */
export const siteConfig = {
  name: "Boardly",
  tagline: "The collaborative whiteboard your team actually stays in.",
  description:
    "Boardly is a real-time collaborative whiteboard. Create workspaces, invite your team, and think together on an infinite canvas.",
} as const;

export type SiteConfig = typeof siteConfig;
