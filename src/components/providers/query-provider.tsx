"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * TanStack Query owns server/application state (workspaces, boards, members,
 * comments, activity). It deliberately does NOT hold collaborative canvas
 * state — that belongs to Liveblocks/tldraw — nor ephemeral UI state, which
 * belongs to Zustand.
 *
 * The client is created inside `useState` rather than at module scope so that
 * each request gets its own cache. A module-scope client would be shared
 * across users on the server and leak one user's data into another's render.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
