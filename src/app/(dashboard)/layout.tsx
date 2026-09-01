import { PenLine } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { siteConfig } from "@/config/site";
import { WorkspaceSwitcher } from "@/features/workspaces/components/workspace-switcher";
import { listWorkspaces } from "@/features/workspaces/data";
import { getCurrentUser, requireUser } from "@/lib/auth/dal";

/**
 * Authenticated shell.
 *
 * `requireUser()` is the authoritative check. `src/proxy.ts` already redirects
 * unauthenticated visitors, but that is an optimistic cookie check made before
 * rendering — this one revalidates the token with the auth server. If the
 * proxy were removed, this layout would still refuse to render.
 */
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  await requireUser("/dashboard");

  const [user, workspaces] = await Promise.all([getCurrentUser(), listWorkspaces()]);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-2 px-6">
          <div className="flex min-w-0 items-center gap-1">
            <Link
              href="/dashboard"
              className="focus-visible:ring-ring flex shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              <PenLine className="size-5" aria-hidden="true" />
              <span className="hidden sm:inline">{siteConfig.name}</span>
            </Link>

            {workspaces.length > 0 ? (
              <>
                <span className="text-muted-foreground/40 select-none" aria-hidden="true">
                  /
                </span>
                <WorkspaceSwitcher workspaces={workspaces} />
              </>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
            {user ? <UserMenu user={user} /> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
