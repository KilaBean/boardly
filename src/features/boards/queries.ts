"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  createBoardAction,
  deleteBoardAction,
  setBoardArchivedAction,
  updateBoardAction,
} from "@/features/boards/actions";
import type { BoardSummary } from "@/features/boards/data";

/**
 * Client-side board state.
 *
 * TanStack Query owns this because the board list is interactive: creating,
 * renaming and archiving should feel instant, which means optimistic updates
 * and a cache to roll back to. Reads come from a GET route handler; writes go
 * through server actions so authorization stays server-side.
 */

export const boardKeys = {
  all: ["boards"] as const,
  workspace: (workspaceId: string) => [...boardKeys.all, "workspace", workspaceId] as const,
};

async function fetchBoards(workspaceId: string): Promise<BoardSummary[]> {
  const response = await fetch(`/api/workspaces/${workspaceId}/boards`);
  if (!response.ok) {
    throw new Error("Could not load boards");
  }
  const payload = (await response.json()) as { boards: BoardSummary[] };
  return payload.boards;
}

/**
 * `initialData` is rendered by the server component, so the first paint has
 * real boards rather than a spinner, and this hook only fetches again after
 * an invalidation.
 */
export function useBoards(workspaceId: string, initialData: BoardSummary[]) {
  return useQuery({
    queryKey: boardKeys.workspace(workspaceId),
    queryFn: () => fetchBoards(workspaceId),
    initialData,
  });
}

/** Shared rollback helper for the optimistic mutations below. */
function useBoardCache(workspaceId: string) {
  const queryClient = useQueryClient();
  const key = boardKeys.workspace(workspaceId);

  return {
    queryClient,
    key,
    /** Snapshot + apply an optimistic change. Returns the previous value. */
    async optimistic(update: (boards: BoardSummary[]) => BoardSummary[]) {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<BoardSummary[]>(key) ?? [];
      queryClient.setQueryData<BoardSummary[]>(key, update(previous));
      return previous;
    },
    rollback(previous: BoardSummary[] | undefined) {
      if (previous) queryClient.setQueryData(key, previous);
    },
    invalidate() {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  };
}

export function useCreateBoard(workspaceId: string) {
  const cache = useBoardCache(workspaceId);

  return useMutation({
    mutationFn: async (input: { name: string; visibility?: "private" | "workspace" }) => {
      const result = await createBoardAction({
        workspaceId,
        name: input.name,
        visibility: input.visibility ?? "workspace",
      });
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      cache.invalidate();
      toast.success("Board created");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useRenameBoard(workspaceId: string) {
  const cache = useBoardCache(workspaceId);

  return useMutation({
    mutationFn: async (input: { boardId: string; name: string }) => {
      const result = await updateBoardAction(input);
      if (!result.ok) throw new Error(result.error);
    },
    onMutate: async ({ boardId, name }) =>
      // Rename in place immediately; the input closes on a board that already
      // shows the new title.
      ({
        previous: await cache.optimistic((boards) =>
          boards.map((board) => (board.id === boardId ? { ...board, name } : board)),
        ),
      }),
    onError: (error: Error, _input, context) => {
      cache.rollback(context?.previous);
      toast.error(error.message);
    },
    onSettled: () => cache.invalidate(),
  });
}

export function useArchiveBoard(workspaceId: string) {
  const cache = useBoardCache(workspaceId);

  return useMutation({
    mutationFn: async (input: { boardId: string; archived: boolean }) => {
      const result = await setBoardArchivedAction({ boardId: input.boardId }, input.archived);
      if (!result.ok) throw new Error(result.error);
    },
    onMutate: async ({ boardId }) => ({
      // The list excludes archived boards, so drop the card straight away.
      previous: await cache.optimistic((boards) => boards.filter((b) => b.id !== boardId)),
    }),
    onError: (error: Error, _input, context) => {
      cache.rollback(context?.previous);
      toast.error(error.message);
    },
    onSuccess: (_data, { archived }) => {
      toast.success(archived ? "Board archived" : "Board restored");
    },
    onSettled: () => cache.invalidate(),
  });
}

export function useDeleteBoard(workspaceId: string) {
  const cache = useBoardCache(workspaceId);

  return useMutation({
    mutationFn: async (input: { boardId: string }) => {
      const result = await deleteBoardAction(input);
      if (!result.ok) throw new Error(result.error);
    },
    onMutate: async ({ boardId }) => ({
      previous: await cache.optimistic((boards) => boards.filter((b) => b.id !== boardId)),
    }),
    onError: (error: Error, _input, context) => {
      cache.rollback(context?.previous);
      toast.error(error.message);
    },
    onSuccess: () => toast.success("Board deleted"),
    onSettled: () => cache.invalidate(),
  });
}
