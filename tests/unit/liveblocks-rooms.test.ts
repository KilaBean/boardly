import { describe, expect, it } from "vitest";

import { boardRoomId, parseBoardRoomId } from "@/lib/liveblocks/rooms";

/**
 * The room name is the only value the client sends to the auth endpoint, and
 * the board id is extracted from it before permissions are checked. A parser
 * that accepts something it should not would point authorization at the wrong
 * board — so it is tested like the trust boundary it is.
 */

const VALID_UUID = "9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";

describe("boardRoomId", () => {
  it("namespaces the board id", () => {
    expect(boardRoomId(VALID_UUID)).toBe(`board:${VALID_UUID}`);
  });

  it("round-trips through the parser", () => {
    expect(parseBoardRoomId(boardRoomId(VALID_UUID))).toBe(VALID_UUID);
  });
});

describe("parseBoardRoomId — accepts", () => {
  it("a well-formed board room", () => {
    expect(parseBoardRoomId(`board:${VALID_UUID}`)).toBe(VALID_UUID);
  });

  it("normalizes case so one board cannot become two rooms", () => {
    expect(parseBoardRoomId(`board:${VALID_UUID.toUpperCase()}`)).toBe(VALID_UUID);
  });
});

describe("parseBoardRoomId — rejects", () => {
  it.each([
    ["", "empty"],
    ["board:", "no id"],
    [VALID_UUID, "missing prefix"],
    [`workspace:${VALID_UUID}`, "wrong prefix"],
    [`board:${VALID_UUID}extra`, "trailing junk"],
    [`board:${VALID_UUID} `, "trailing space"],
    [`board: ${VALID_UUID}`, "leading space"],
    ["board:not-a-uuid", "not a uuid"],
    ["board:11111111-1111-1111-1111-111111111111", "invalid uuid variant bits"],
    [`board:${VALID_UUID}/../other`, "path traversal attempt"],
    [`board:${VALID_UUID}:board:${VALID_UUID}`, "two ids"],
    ["Board:" + VALID_UUID, "wrong-case prefix"],
    ["board:'; drop table boards;--", "sql-ish payload"],
  ])("rejects %j (%s)", (roomId) => {
    expect(parseBoardRoomId(roomId)).toBeNull();
  });

  it.each([[null], [undefined], [42], [{}], [["board:" + VALID_UUID]]])(
    "rejects the non-string %j",
    (value) => {
      expect(parseBoardRoomId(value)).toBeNull();
    },
  );
});
