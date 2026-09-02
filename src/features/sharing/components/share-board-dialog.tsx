"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, Link2, Loader2, Share2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { TextField } from "@/components/forms/text-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  createInvitationAction,
  disableShareLinkAction,
  enableShareLinkAction,
  removeBoardMemberAction,
  revokeInvitationAction,
  setBoardMemberRoleAction,
} from "@/features/sharing/actions";
import type { BoardMemberEntry, PendingInvitation } from "@/features/sharing/data";
import { rethrowIfNavigation, UNEXPECTED_ERROR } from "@/lib/forms/action-error";
import { INVITATION_TTL_DAYS } from "@/lib/invitations/constants";
import { emailSchema } from "@/lib/validation/schemas";

const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(["editor", "viewer"]),
});

type InviteValues = z.infer<typeof inviteSchema>;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Copy button that falls back to selecting the text if the API is blocked. */
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        aria-label="Invitation link"
        onFocus={(event) => event.currentTarget.select()}
        className="border-input bg-muted/40 min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard access can be denied; the input is selectable instead.
            toast.message("Select the link and copy it manually.");
          }
        }}
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function ShareBoardDialog({
  boardId,
  workspaceId,
  isOwner,
  members,
  invitations,
  shareLinkEnabled,
}: {
  boardId: string;
  workspaceId: string;
  isOwner: boolean;
  members: BoardMemberEntry[];
  invitations: PendingInvitation[];
  shareLinkEnabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ url: string; email: string; delivered: boolean } | null>(
    null,
  );
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "editor" },
  });

  async function onInvite(values: InviteValues) {
    setFormError(null);
    try {
      const result = await createInvitationAction({
        target: "board",
        boardId,
        workspaceId,
        email: values.email,
        role: values.role,
      });

      if (!result.ok) {
        setFormError(result.error);
        return;
      }

      setInvite(result.data);
      reset();
      router.refresh();
    } catch (error) {
      rethrowIfNavigation(error);
      setFormError(UNEXPECTED_ERROR);
    }
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          toast.error(result.error ?? UNEXPECTED_ERROR);
          return;
        }
        toast.success(success);
        router.refresh();
      } catch (error) {
        rethrowIfNavigation(error);
        toast.error(UNEXPECTED_ERROR);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          // The raw token is shown once and never stored, so clear it rather
          // than leaving it sitting in component state.
          setInvite(null);
          setShareUrl(null);
          setFormError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="size-4" aria-hidden="true" />
          Share
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share board</DialogTitle>
          <DialogDescription>
            Invite people directly, or create a view-only link anyone can open.
          </DialogDescription>
        </DialogHeader>

        {!isOwner ? (
          <Alert>
            <AlertDescription>Only the board owner can change who has access.</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-6">
            {/* ---------------- Invite by email ---------------- */}
            <section className="space-y-3">
              {formError ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}

              <form onSubmit={handleSubmit(onInvite)} noValidate className="flex items-end gap-2">
                <div className="flex-1">
                  <TextField
                    label="Invite by email"
                    type="email"
                    placeholder="teammate@example.com"
                    error={errors.email?.message}
                    {...register("email")}
                  />
                </div>
                {/*
                  Registered rather than driven by `setValue` on change. As an
                  uncontrolled select it kept its displayed value through the
                  `reset()` after a successful invite while the form state went
                  back to "editor" — so the next invite silently granted edit
                  access while the UI still read "Can view".
                */}
                <select
                  aria-label="Access level"
                  {...register("role")}
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                >
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                </select>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Invite
                </Button>
              </form>

              {invite ? (
                <div className="space-y-2 rounded-md border p-3">
                  {/*
                    The link is shown either way. When the email went out it is
                    a convenience; when it did not, it is the only way the
                    invitation reaches anybody, so it must never be hidden
                    behind a claim of delivery we cannot stand behind.
                  */}
                  <p className="text-muted-foreground text-xs">
                    {invite.delivered ? (
                      <>
                        Invitation emailed to <span className="font-medium">{invite.email}</span>.
                        You can also share the link directly.
                      </>
                    ) : (
                      <>We could not send the email — copy this link and send it yourself.</>
                    )}{" "}
                    It works once, for that address only, and expires in {INVITATION_TTL_DAYS} days.
                  </p>
                  <CopyLink url={invite.url} />
                </div>
              ) : null}
            </section>

            {/* ---------------- People with access ---------------- */}
            {members.length > 0 || invitations.length > 0 ? (
              <>
                <Separator />
                <section className="space-y-3">
                  <h3 className="text-sm font-medium">People with access</h3>

                  <ul className="space-y-2">
                    {members.map((member) => (
                      <li key={member.userId} className="flex items-center gap-3">
                        <Avatar className="size-7">
                          {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
                          <AvatarFallback className="text-[10px]">
                            {initials(member.displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="flex-1 truncate text-sm">{member.displayName}</span>

                        <select
                          aria-label={`Access level for ${member.displayName}`}
                          value={member.role}
                          disabled={isPending}
                          onChange={(event) =>
                            run(
                              () =>
                                setBoardMemberRoleAction({
                                  boardId,
                                  userId: member.userId,
                                  role: event.target.value as "editor" | "viewer",
                                }),
                              "Access updated",
                            )
                          }
                          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                        >
                          <option value="editor">Can edit</option>
                          <option value="viewer">Can view</option>
                        </select>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={isPending}
                          aria-label={`Remove ${member.displayName}`}
                          onClick={() =>
                            run(
                              () => removeBoardMemberAction({ boardId, userId: member.userId }),
                              "Removed",
                            )
                          }
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      </li>
                    ))}

                    {invitations.map((invitation) => (
                      <li key={invitation.id} className="flex items-center gap-3">
                        <Avatar className="size-7">
                          <AvatarFallback className="text-[10px]">
                            {initials(invitation.email)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{invitation.email}</span>
                          <span className="text-muted-foreground text-xs">Invitation pending</span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            run(
                              () => revokeInvitationAction({ invitationId: invitation.id }),
                              "Invitation revoked",
                            )
                          }
                        >
                          Revoke
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            ) : null}

            {/* ---------------- Public link ---------------- */}
            <Separator />
            <section className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="flex items-center gap-1.5 text-sm font-medium">
                    <Link2 className="size-3.5" aria-hidden="true" />
                    Anyone with the link
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    {shareLinkEnabled
                      ? "A view-only link is active."
                      : "Off. Nobody can open this board without an invitation."}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={shareLinkEnabled ? "outline" : "default"}
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await enableShareLinkAction({ boardId });
                        if (!result.ok) {
                          toast.error(result.error);
                          return;
                        }
                        setShareUrl(result.data.url);
                        toast.success(shareLinkEnabled ? "New link created" : "Link created");
                        router.refresh();
                      })
                    }
                  >
                    {shareLinkEnabled ? "Regenerate" : "Create link"}
                  </Button>

                  {shareLinkEnabled ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() =>
                        run(() => disableShareLinkAction({ boardId }), "Link disabled")
                      }
                    >
                      Turn off
                    </Button>
                  ) : null}
                </div>
              </div>

              {shareUrl ? <CopyLink url={shareUrl} /> : null}

              {shareLinkEnabled && !shareUrl ? (
                <p className="text-muted-foreground text-xs">
                  {/* Only the hash is stored, so the URL cannot be shown again. */}
                  The existing link can&apos;t be displayed again — only its fingerprint is stored.
                  Regenerate to get a new one, which also revokes the old.
                </p>
              ) : null}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
