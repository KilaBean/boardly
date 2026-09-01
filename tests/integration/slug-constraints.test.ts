// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { slugify, withSuffix } from "@/lib/workspaces/slug";

import { createTestDb, type TestDb } from "../helpers/database";

/**
 * `slugify()` exists to satisfy two SQL CHECK constraints:
 *
 *   workspaces_slug_format: ^[a-z0-9]+(-[a-z0-9]+)*$
 *   workspaces_slug_length: 2..48
 *
 * A unit test can only assert against a *copy* of those rules, which is
 * exactly the kind of duplication that drifts. This suite feeds generated
 * slugs to the real table instead, so the database itself is the judge.
 */

let t: TestDb;
let owner: string;

const HOSTILE_NAMES = [
  "Acme",
  "A",
  "  ",
  "---",
  "🎨",
  "研究室",
  "Café Zürich",
  "Hello, World! (2026)",
  "ALL CAPS WORKSPACE",
  "trailing-hyphen-",
  "-leading-hyphen",
  "double--hyphen",
  "under_scores_and.dots",
  "x".repeat(200),
  "a b c d e f g h i j k l m n o p q r s t u v w x y z 1 2 3",
  "Ünïcødé Wörkspäce Nåme",
  "123456",
  "workspace!!!",
  "  spaced   out   name  ",
  "\t\nwhitespace\t\n",
];

beforeAll(async () => {
  t = await createTestDb();
  owner = await t.createUser("slug-owner@example.com", "Owner");
  await t.asAdmin();
});

afterAll(async () => {
  await t?.close();
});

describe("generated slugs satisfy the real database constraints", () => {
  it.each(HOSTILE_NAMES)("accepts a workspace named %j", async (name) => {
    const slug = slugify(name);

    // Unique-ify so repeated fallbacks ("workspace") do not collide across
    // cases; withSuffix must also keep the result constraint-compliant.
    const unique = withSuffix(slug, Math.floor(Math.random() * 100_000));

    // The name column is capped at 80 characters, and createWorkspaceSchema
    // rejects anything longer before it reaches the database — so mirror that
    // here. The point of this case is the slug derived from a long name, not
    // storing the long name itself.
    const storedName = name.trim().slice(0, 80) || "Untitled";

    const result = await t.db.query<{ slug: string }>(
      `insert into public.workspaces (name, slug, owner_id)
       values ($1, $2, $3) returning slug`,
      [storedName, unique, owner],
    );

    expect(result.rows[0]!.slug).toBe(unique);
  });
});

describe("the constraints actually reject bad slugs", () => {
  // Guards against the suite above passing vacuously because the constraint
  // is missing or permissive.
  it.each([
    ["A", "uppercase"],
    ["a", "too short"],
    ["-acme", "leading hyphen"],
    ["acme-", "trailing hyphen"],
    ["acme--corp", "double hyphen"],
    ["acme corp", "space"],
    ["acme_corp", "underscore"],
    ["x".repeat(49), "too long"],
  ])("rejects %j (%s)", async (slug) => {
    await expect(
      t.db.query(`insert into public.workspaces (name, slug, owner_id) values ('X', $1, $2)`, [
        slug,
        owner,
      ]),
    ).rejects.toThrow(/workspaces_slug_(format|length)/);
  });
});
