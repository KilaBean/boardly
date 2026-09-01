import { AlertCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { acceptInvitation } from "@/features/sharing/invitations";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Join" };

/**
 * Accepts an invitation.
 *
 * Acceptance happens on load rather than behind a confirm button: the user
 * already opted in by following the link, and an extra click would only add
 * friction. It is safe to do on a GET here because the operation is
 * idempotent — the SQL function is single-use and locks the row, so a
 * prefetch or double-load cannot join twice or consume a second invitation.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;

  // Sends unauthenticated visitors to sign-in and back again, so an invitation
  // link works even for someone who has to create an account first.
  await requireUser(`/invite/${token}`);

  const result = await acceptInvitation(token);

  if (result.ok) {
    redirect(result.data.boardId ? `/board/${result.data.boardId}` : "/dashboard");
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-10 text-center">
      <AlertCircle className="text-muted-foreground mx-auto size-10" aria-hidden="true" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">This invitation didn&apos;t work</h1>
        <Alert variant="destructive" role="alert" className="text-left">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      </div>
      <Button asChild variant="outline" className="w-full">
        <Link href="/dashboard">Go to your dashboard</Link>
      </Button>
    </div>
  );
}
