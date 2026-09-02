"use client";

import { PencilLine } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { redeemShareLinkAction } from "@/features/sharing/actions";
import { rethrowIfNavigation, UNEXPECTED_ERROR } from "@/lib/forms/action-error";

/**
 * Accepts an edit share link.
 *
 * A button rather than something the page does while rendering: redeeming
 * changes board membership, and a GET that mutates would fire on every preview
 * fetch, link scanner and back-navigation. Making it explicit also means the
 * visitor sees which board they are joining first.
 */
export function JoinSharedBoard({ token }: { token: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              const result = await redeemShareLinkAction({ token });
              if (!result.ok) {
                setError(result.error);
                toast.error(result.error);
                return;
              }
              router.replace(`/board/${result.data.boardId}`);
            } catch (caught) {
              rethrowIfNavigation(caught);
              setError(UNEXPECTED_ERROR);
              toast.error(UNEXPECTED_ERROR);
            }
          })
        }
      >
        <PencilLine className="size-4" aria-hidden="true" />
        {isPending ? "Joining…" : "Join to edit"}
      </Button>

      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
