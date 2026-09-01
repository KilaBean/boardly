import { describe, expect, it } from "vitest";

import {
  isValidSlug,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  slugify,
  withSuffix,
} from "@/lib/workspaces/slug";

describe("slugify", () => {
  it.each([
    ["Acme", "acme"],
    ["Acme Design", "acme-design"],
    ["  Acme   Design  ", "acme-design"],
    ["ACME DESIGN", "acme-design"],
    ["Acme & Co.", "acme-co"],
    ["Team 42", "team-42"],
    ["a---b", "a-b"],
    ["--Acme--", "acme"],
  ])("turns %j into %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("transliterates accents rather than dropping the letters", () => {
    // "caf-zrich" would be the result of naive stripping.
    expect(slugify("Café Zürich")).toBe("cafe-zurich");
  });

  it("falls back when a name has no usable ASCII", () => {
    expect(slugify("🎨")).toBe("workspace");
    expect(slugify("研究室")).toBe("workspace");
    expect(slugify("!!!")).toBe("workspace");
    expect(slugify("")).toBe("workspace");
  });

  it("pads a single-character name to meet the minimum length", () => {
    // "a" satisfies the format rule but not the 2-character minimum.
    expect(slugify("A")).toBe("a-1");
    expect(isValidSlug(slugify("A"))).toBe(true);
  });

  it("truncates a long name at a word boundary", () => {
    const result = slugify("Supercalifragilistic Expialidocious Workspace For Very Long Names");
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(result.endsWith("-")).toBe(false);
    expect(isValidSlug(result)).toBe(true);
  });

  it("handles a single word longer than the limit", () => {
    const result = slugify("a".repeat(200));
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(isValidSlug(result)).toBe(true);
  });

  it("always produces a slug the database will accept", () => {
    const names = [
      "Acme",
      "A",
      "🎨🎨🎨",
      "   ",
      "---",
      "Ünïcødé Wörkspäce",
      "x".repeat(100),
      "Hello, World! (2026)",
      "研究室 Lab",
      "a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s-t-u-v-w-x-y-z",
    ];

    for (const name of names) {
      const slug = slugify(name);
      expect(isValidSlug(slug), `slugify(${JSON.stringify(name)}) -> ${slug}`).toBe(true);
    }
  });
});

describe("withSuffix", () => {
  it("appends a numeric suffix", () => {
    expect(withSuffix("acme", 2)).toBe("acme-2");
  });

  it("keeps the result inside the length limit", () => {
    const long = "a".repeat(SLUG_MAX_LENGTH);
    const result = withSuffix(long, 12);
    expect(result.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(result.endsWith("-12")).toBe(true);
    expect(isValidSlug(result)).toBe(true);
  });

  it("never leaves a doubled hyphen when truncating", () => {
    const result = withSuffix(`${"a".repeat(SLUG_MAX_LENGTH - 3)}-b`, 9);
    expect(result).not.toContain("--");
    expect(isValidSlug(result)).toBe(true);
  });
});

describe("isValidSlug", () => {
  it.each(["ab", "acme", "acme-design", "a1-b2"])("accepts %s", (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each(["a", "-acme", "acme-", "acme--x", "Acme", "acme_x", "acme x", "x".repeat(49)])(
    "rejects %s",
    (slug) => {
      expect(isValidSlug(slug)).toBe(false);
    },
  );

  it("agrees with the documented bounds", () => {
    expect(isValidSlug("x".repeat(SLUG_MIN_LENGTH))).toBe(true);
    expect(isValidSlug("x".repeat(SLUG_MAX_LENGTH))).toBe(true);
    expect(isValidSlug("x".repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
  });
});
