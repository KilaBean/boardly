"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  createCommentAction,
  deleteCommentAction,
  resolveCommentAction,
} from "@/features/comments/actions";
import type { CommentPage } from "@/features/comments/data";

/**
 * Client-side comment state.
 *
 * `useInfiniteQuery` rather than `useQuery`: comment threads are paginated
 * (the PRD requires it) and "load older" is the natural interaction. Mutations
 * invalidate rather than patch the cache — a comment's server-assigned id,
 * timestamp and author profile are all needed to render it, so an optimistic
 * insert would have to invent three values and then correct them.
 */

export const commentKeys = {
  all: ["comments"] as const,
  board: (boardId: string, unresolvedOnly: boolean) =>
    [...commentKeys.all, boardId, { unresolvedOnly }] as const,
};

async function fetchComments(
  boardId: string,
  before: string | undefined,
  unresolvedOnly: boolean,
): Promise<CommentPage> {
  const params = new URLSearchParams();
  if (before) params.set("before", before);
  if (unresolvedOnly) params.set("unresolved", "1");

  const query = params.toString();
  const response = await fetch(`/api/boards/${boardId}/comments${query ? `?${query}` : ""}`);
  if (!response.ok) throw new Error("Could not load comments");

  return (await response.json()) as CommentPage;
}

export function useComments(boardId: string, unresolvedOnly: boolean, initialPage: CommentPage) {
  return useInfiniteQuery({
    queryKey: commentKeys.board(boardId, unresolvedOnly),
    queryFn: ({ pageParam }) => fetchComments(boardId, pageParam, unresolvedOnly),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Seed ONLY the unresolved view. The board page renders
    // `listComments(boardId, { unresolvedOnly: true })`, so that page is not a
    // valid starting point for the "show resolved" view — and because
    // `initialData` counts as fresh, seeding both keys left the resolved view
    // showing unresolved-only data until staleTime expired.
    initialData: unresolvedOnly ? { pages: [initialPage], pageParams: [undefined] } : undefined,
  });
}

function useInvalidateComments(boardId: string) {
  const queryClient = useQueryClient();
  return () => {
    // Both filtered views can be affected by any mutation.
    void queryClient.invalidateQueries({ queryKey: [...commentKeys.all, boardId] });
  };
}

export function useCreateComment(boardId: string) {
  const invalidate = useInvalidateComments(boardId);

  return useMutation({
    mutationFn: async (input: { body: string; positionX?: number; positionY?: number }) => {
      const result = await createCommentAction({
        boardId,
        body: input.body,
        positionX: input.positionX ?? null,
        positionY: input.positionY ?? null,
      });
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useResolveComment(boardId: string) {
  const invalidate = useInvalidateComments(boardId);

  return useMutation({
    mutationFn: async (input: { commentId: string; resolved: boolean }) => {
      const result = await resolveCommentAction(input);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: (_data, { resolved }) => {
      invalidate();
      toast.success(resolved ? "Comment resolved" : "Comment reopened");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteComment(boardId: string) {
  const invalidate = useInvalidateComments(boardId);

  return useMutation({
    mutationFn: async (input: { commentId: string }) => {
      const result = await deleteCommentAction(input);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Comment deleted");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}
