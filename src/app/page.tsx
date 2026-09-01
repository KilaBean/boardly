import { PenLine } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { getUser } from "@/lib/auth/dal";

/**
 * Landing page.
 *
 * Still a foundation placeholder rather than the full marketing page, but it
 * now reflects session state so the auth flow has a real entry point.
 */
export default async function HomePage() {
  const user = await getUser();

  return (
    <main className="flex flex-1 flex-col">
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

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="max-w-xl text-center">
          <p className="text-muted-foreground text-sm font-medium">Phase 3 · Authentication</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {siteConfig.tagline}
          </h1>
          <p className="text-muted-foreground mt-4 text-base text-pretty">
            Accounts, sessions and protected routes are wired up. Workspaces, boards and the
            collaborative canvas come next.
          </p>

          {user ? null : (
            <div className="mt-8 flex justify-center gap-3">
              <Button asChild>
                <Link href="/sign-up">Create an account</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/sign-in">Sign in</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
