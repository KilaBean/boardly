"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Wraps next-themes so the rest of the app never imports it directly.
 * `attribute="class"` matches the `@custom-variant dark (&:is(.dark *))`
 * declared in globals.css, which is what makes the Tailwind v4 `dark:` variant
 * resolve against the token set.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
