"use client";

import { useOthers, useStatus } from "@liveblocks/react";
import { CloudOff, Loader2, Users } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Connection state and who else is here.
 *
 * The PRD requires connection state to be visible when disconnected or
 * reconnecting. It is deliberately *invisible* while healthy: a permanent
 * "connected" badge is noise that trains people to ignore the one moment it
 * matters.
 */
export function ConnectionStatus() {
  const status = useStatus();

  if (status === "connected") return null;

  const reconnecting = status === "connecting" || status === "reconnecting";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs shadow-sm backdrop-blur",
        reconnecting
          ? "bg-background/90 text-muted-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {reconnecting ? (
        <>
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Reconnecting…
        </>
      ) : (
        <>
          <CloudOff className="size-3" aria-hidden="true" />
          Offline — changes will sync when you reconnect
        </>
      )}
    </div>
  );
}

/** Two-letter monogram fallback. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

const MAX_VISIBLE = 4;

/**
 * Collaborator avatars.
 *
 * Names accompany every avatar via `alt`/fallback text rather than relying on
 * the cursor colour, so collaborators are identifiable without colour vision.
 */
export function Collaborators() {
  const others = useOthers();

  if (others.length === 0) return null;

  const visible = others.slice(0, MAX_VISIBLE);
  const overflow = others.length - visible.length;

  return (
    <div className="flex items-center gap-1.5">
      <Users className="text-muted-foreground size-3.5" aria-hidden="true" />
      <ul
        className="flex -space-x-2"
        aria-label={`${others.length} ${others.length === 1 ? "collaborator" : "collaborators"} on this board`}
      >
        {visible.map((other) => {
          const name = (other.info?.name as string | undefined) ?? "Collaborator";
          const avatar = other.info?.avatar as string | undefined;
          return (
            <li key={other.connectionId}>
              <Avatar className="border-background size-6 border-2">
                {avatar ? <AvatarImage src={avatar} alt="" /> : null}
                <AvatarFallback className="text-[10px]">{initials(name)}</AvatarFallback>
              </Avatar>
              <span className="sr-only">{name}</span>
            </li>
          );
        })}
        {overflow > 0 ? (
          <li>
            <Avatar className="border-background size-6 border-2">
              <AvatarFallback className="text-[10px]">+{overflow}</AvatarFallback>
            </Avatar>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
