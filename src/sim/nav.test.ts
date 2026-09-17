import assert from "node:assert/strict";
import { test } from "node:test";
import { locFromBody, trimLeadingWaypoints } from "./nav.ts";
import type { Loc, Waypoint } from "./types.ts";

test("locFromBody uses the interpolated cell, not the snapped loc", () => {
  const loc: Loc = { layer: "city", x: 10, y: 4 };
  const body = locFromBody(loc, 12.7, 4.2);
  assert.equal(body.x, 12);
  assert.equal(body.y, 4);
  assert.equal(body.layer, "city");
});

test("trimLeadingWaypoints drops the cell the body is already on", () => {
  const loc: Loc = { layer: "city", x: 10, y: 5 };
  const path: Waypoint[] = [
    { layer: "city", x: 12, y: 5 },
    { layer: "city", x: 13, y: 5 },
    { layer: "city", x: 14, y: 5 },
  ];
  const trimmed = trimLeadingWaypoints(path, 12.6, 5.4, loc);
  assert.equal(trimmed[0]!.x, 13);
});

test("trimLeadingWaypoints drops a first waypoint behind the body", () => {
  const loc: Loc = { layer: "city", x: 8, y: 5 };
  const path: Waypoint[] = [
    { layer: "city", x: 10, y: 5 },
    { layer: "city", x: 11, y: 5 },
    { layer: "city", x: 12, y: 5 },
  ];
  const trimmed = trimLeadingWaypoints(path, 10.8, 5.5, loc);
  assert.equal(trimmed[0]!.x, 11);
});
