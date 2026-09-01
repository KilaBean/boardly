"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { History, Loader2 } from "lucide-react";

import { EmptyState } from "@/components/layout/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { ActivityPage } from "@/features/activity/data";
import { describeActivity, relativeTime } from "@/features/activity/format";

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

async function fetchActivity(workspaceId: string, before?: string): Promise<ActivityPage> {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  const response = await fetch(`/api/workspaces/${workspaceId}/activity${query}`);
  if (!response.ok) throw new Error("Could not load activity");
  return (await response.json()) as ActivityPage;
}

/**
 * Workspace activity.
 *
 * Keyset-paginated: the feed grows while it is being read, and `offset` would
 * skip or repeat entries as new events land. The first page is server
 * rendered, so the section is never a spinner on load.
 */
export function ActivityFeed({
  workspaceId,
  initialPage,
}: {
  workspaceId: string;
  initialPage: ActivityPage;
}) {
  const query = useInfiniteQuery({
    queryKey: ["activity", workspaceId],
    queryFn: ({ pageParam }) => fetchActivity(workspaceId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialData: { pages: [initialPage], pageParams: [undefined] },
  });

  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];

  if (query.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        Could not load activity.
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Nothing has happened yet"
        description="Board and membership changes in this workspace will show up here."
      />
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {entries.map((entry) => {
          const { actor, action } = describeActivity(
            entry.eventType,
            entry.actorName,
            entry.metadata,
          );

          return (
            <li key={entry.id} className="flex items-start gap-2.5">
              <Avatar className="mt-0.5 size-6 shrink-0">
                {entry.actorAvatarUrl ? <AvatarImage src={entry.actorAvatarUrl} alt="" /> : null}
                <AvatarFallback className="text-[10px]">{initials(entry.actorName)}</AvatarFallback>
              </Avatar>

              <p className="text-sm leading-snug">
                <span className="font-medium">{actor}</span>{" "}
                <span className="text-muted-foreground">{action}</span>{" "}
                <time
                  dateTime={entry.createdAt}
                  className="text-muted-foreground whitespace-nowrap"
                >
                  {relativeTime(entry.createdAt)}
                </time>
              </p>
            </li>
          );
        })}
      </ul>

      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : null}
          Load older activity
        </Button>
      ) : null}
    </div>
  );
}
