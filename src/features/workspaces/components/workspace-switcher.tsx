"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkspaceSummary } from "@/features/workspaces/data";
import { cn } from "@/lib/utils";

import { CreateWorkspaceDialog } from "./create-workspace-dialog";

export function WorkspaceSwitcher({ workspaces }: { workspaces: WorkspaceSummary[] }) {
  const [createOpen, setCreateOpen] = useState(false);
  const pathname = usePathname();

  // Derived from the URL rather than passed down: the shared dashboard layout
  // has no [slug] segment of its own, so it cannot know which workspace is
  // active without threading it through every page.
  const activeSlug = pathname.startsWith("/w/") ? (pathname.split("/")[2] ?? "") : "";
  const active = workspaces.find((w) => w.slug === activeSlug) ?? workspaces[0];

  if (!active) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="max-w-[16rem] justify-between gap-2 px-2"
            // The visible label is the workspace name; the accessible name
            // says what the control actually does.
            aria-label={`Switch workspace. Current workspace: ${active.name}`}
          >
            <span className="truncate font-medium">{active.name}</span>
            <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            Workspaces
          </DropdownMenuLabel>

          {workspaces.map((workspace) => {
            const isActive = workspace.slug === active.slug;
            return (
              <DropdownMenuItem key={workspace.id} asChild>
                <Link href={`/w/${workspace.slug}`} className="cursor-pointer">
                  <Check
                    className={cn("size-4", isActive ? "opacity-100" : "opacity-0")}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate">{workspace.name}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {workspace.boardCount}
                  </span>
                </Link>
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={(event) => {
              // Let the menu close before the dialog opens, or focus is
              // returned to a trigger that no longer exists.
              event.preventDefault();
              setCreateOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
