import { describe, expect, it } from "vitest";

import { describeActivity, relativeTime } from "@/features/activity/format";
import type { ActivityEventType } from "@/types/database";

/**
 * The activity feed renders rows written by earlier versions of the app, by
 * users who may since have deleted their accounts. Every defensive branch here
 * corresponds to something the schema actually permits:
 *
 *   - `actor_id` is ON DELETE SET NULL, so the actor really can be missing.
 *   - `metadata` is untyped jsonb, so any key may be absent or the wrong type.
 */

const ALL_EVENTS: ActivityEventType[] = [
  "board.created",
  "board.renamed",
  "board.archived",
  "board.restored",
  "board.deleted",
  "board.visibility_changed",
  "board.shared",
  "member.invited",
  "member.joined",
  "member.removed",
  "member.role_changed",
  "comment.created",
  "comment.resolved",
];

describe("describeActivity", () => {
  it.each(ALL_EVENTS)("produces a non-empty description for %s", (eventType) => {
    const result = describeActivity(eventType, "Ada", {});
    expect(result.actor).toBe("Ada");
    expect(result.action.trim().length).toBeGreaterThan(0);
    expect(result.action).not.toContain("undefined");
    expect(result.action).not.toContain("null");
  });

  it.each(ALL_EVENTS)("survives a deleted actor for %s", (eventType) => {
    // ON DELETE SET NULL keeps the audit trail; the feed must still read.
    const result = describeActivity(eventType, null, {});
    expect(result.actor).toBe("Someone");
    expect(result.action.trim().length).toBeGreaterThan(0);
  });

  it.each(ALL_EVENTS)("survives null metadata for %s", (eventType) => {
    const result = describeActivity(eventType, "Ada", null);
    expect(result.action.trim().length).toBeGreaterThan(0);
  });

  it.each(ALL_EVENTS)("survives array metadata for %s", (eventType) => {
    // jsonb permits arrays; metaString must not index into one.
    const result = describeActivity(eventType, "Ada", [1, 2, 3]);
    expect(result.action.trim().length).toBeGreaterThan(0);
  });

  it("treats a blank actor name as deleted", () => {
    expect(describeActivity("board.created", "   ", {}).actor).toBe("Someone");
  });

  it("includes the board name when metadata carries one", () => {
    expect(describeActivity("board.created", "Ada", { name: "Roadmap" }).action).toContain(
      "Roadmap",
    );
  });

  it("falls back gracefully when the name is the wrong type", () => {
    const result = describeActivity("board.created", "Ada", { name: 42 });
    expect(result.action).toBe("created a board");
  });

  it("distinguishes the two visibility changes", () => {
    expect(
      describeActivity("board.visibility_changed", "A", { visibility: "private" }).action,
    ).toContain("private");
    expect(
      describeActivity("board.visibility_changed", "A", { visibility: "workspace" }).action,
    ).toContain("workspace");
    // Unknown value still reads as a sentence.
    expect(describeActivity("board.visibility_changed", "A", { visibility: "?" }).action).toBe(
      "changed a board's visibility",
    );
  });

  it("never reveals who was invited", () => {
    // The feed is visible to every workspace member; the invitee's address is
    // not their business until the person actually joins.
    const result = describeActivity("member.invited", "Ada", {
      role: "member",
      email: "secret@example.com",
    });
    expect(result.action).not.toContain("secret@example.com");
    expect(result.action).toContain("member");
  });

  it("does not say an owner 'joined as owner'", () => {
    expect(describeActivity("member.joined", "Ada", { role: "owner" }).action).toBe("joined");
    expect(describeActivity("member.joined", "Ada", { role: "member" }).action).toBe(
      "joined as member",
    );
  });

  it("distinguishes board and workspace removal", () => {
    expect(describeActivity("member.removed", "A", { scope: "board" }).action).toContain("board");
    expect(describeActivity("member.removed", "A", { scope: "workspace" }).action).toBe(
      "removed someone",
    );
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-08-25T12:00:00Z");

  it.each([
    ["2026-08-25T11:59:30Z", /second|now/i],
    ["2026-08-25T11:30:00Z", /minute/],
    ["2026-08-25T09:00:00Z", /hour/],
    ["2026-08-22T12:00:00Z", /day/],
    ["2026-07-25T12:00:00Z", /month/],
  ])("formats %s relative to now", (iso, pattern) => {
    expect(relativeTime(iso, now)).toMatch(pattern);
  });

  it("returns an empty string for an unparseable date", () => {
    expect(relativeTime("not-a-date", now)).toBe("");
  });
});
