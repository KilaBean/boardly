import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ThemeProvider } from "@/components/providers/theme-provider";

describe("ThemeToggle", () => {
  it("exposes an accessible name so the control is reachable without sight", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(screen.getByRole("button", { name: /change theme/i })).toBeInTheDocument();
  });
});
