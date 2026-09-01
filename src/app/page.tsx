import {
  ArrowRight,
  History,
  MessageSquare,
  MousePointer2,
  PenLine,
  Share2,
  Shield,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { getUser } from "@/lib/auth/dal";

/**
 * Marketing landing page.
 *
 * Every claim below describes behaviour that exists — the canvas, live
 * cursors, anchored comments, share links and per-board roles are all
 * implemented. Nothing here is aspirational; a landing page that oversells is
 * a bug report waiting to happen.
 */

const FEATURES = [
  {
    icon: PenLine,
    title: "An infinite canvas",
    body: "Draw, write, and arrange shapes, arrows, sticky notes and images with no edges to run out of. Full keyboard shortcuts, undo and redo.",
  },
  {
    icon: MousePointer2,
    title: "Everyone, at once",
    body: "See collaborators' cursors and selections as they move. Edits converge without conflicts, and reconnection is handled for you.",
  },
  {
    icon: MessageSquare,
    title: "Comments that stay put",
    body: "Pin a comment to the exact spot on the board it refers to, then resolve the thread once it is settled.",
  },
  {
    icon: Share2,
    title: "Share carefully",
    body: "Invite people by email as an editor or viewer, or publish a read-only link. Regenerating a link revokes the old one instantly.",
  },
  {
    icon: History,
    title: "Know what changed",
    body: "An activity trail records boards created and renamed, people joining, and comments resolved — so nothing happens silently.",
  },
  {
    icon: Shield,
    title: "Private by default",
    body: "Access is enforced in the database itself, not just the interface. A board marked private stays private, even from workspace admins.",
  },
] as const;

export default async function HomePage() {
  const user = await getUser();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <PenLine className="size-5" aria-hidden="true" />
          <span className="font-semibold tracking-tight">{siteConfig.name}</span>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/sign-up">Get started</Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <main className="flex-1">
        {/* ---------------------------------------------------------------- */}
        <section className="mx-auto max-w-3xl px-6 py-20 text-center sm:py-28">
          <p className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
            <Sparkles className="size-3.5" aria-hidden="true" />
            Real-time collaborative whiteboard
          </p>

          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            {siteConfig.tagline}
          </h1>

          <p className="text-muted-foreground mx-auto mt-6 max-w-xl text-lg text-pretty">
            Create a workspace, invite the people you work with, and think together on an infinite
            canvas — with everyone&apos;s cursor visible and every change arriving as it happens.
          </p>

          {user ? (
            <div className="mt-10 flex justify-center">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Open your dashboard
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          ) : (
            <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/sign-up">
                  Start a board — it&apos;s free
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/sign-in">Sign in</Link>
              </Button>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        <section aria-labelledby="features-heading" className="mx-auto max-w-5xl px-6 pb-24">
          <h2 id="features-heading" className="sr-only">
            What Boardly does
          </h2>

          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-lg border p-5">
                <div className="bg-muted text-foreground flex size-9 items-center justify-center rounded-md">
                  <Icon className="size-4.5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-sm font-semibold tracking-tight">{title}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm text-pretty">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------------------------------------------------------------- */}
        {user ? null : (
          <section className="border-t">
            <div className="mx-auto max-w-3xl px-6 py-16 text-center">
              <h2 className="text-2xl font-semibold tracking-tight text-balance">
                Your first board is a minute away
              </h2>
              <p className="text-muted-foreground mx-auto mt-3 max-w-md text-pretty">
                No setup, no template to choose. Make a workspace, open a board, and start drawing.
              </p>
              <Button asChild size="lg" className="mt-8">
                <Link href="/sign-up">
                  Create your account
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 py-6 text-sm sm:flex-row">
          <span className="flex items-center gap-1.5">
            <PenLine className="size-4" aria-hidden="true" />
            {siteConfig.name}
          </span>
          <span>{siteConfig.description}</span>
        </div>
      </footer>
    </div>
  );
}
