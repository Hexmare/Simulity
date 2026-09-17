import assert from "node:assert/strict";
import { test } from "node:test";
import { clampZoom, panCam, screenToWorld, ZOOM_MAX, ZOOM_MIN, zoomToward } from "./camera.ts";

test("zoom stays inside 8–48", () => {
  assert.equal(clampZoom(2), ZOOM_MIN);
  assert.equal(clampZoom(80), ZOOM_MAX);
  assert.equal(clampZoom(16), 16);
});

test("wheel zoom keeps the world point under the cursor", () => {
  const cam = { x: 20, y: 12, z: 16 };
  const viewW = 800;
  const viewH = 600;
  const sx = 560;
  const sy = 180;
  const before = screenToWorld(cam, sx, sy, viewW, viewH);
  zoomToward(cam, sx, sy, viewW, viewH, 1.25);
  const after = screenToWorld(cam, sx, sy, viewW, viewH);
  assert.ok(Math.abs(after.x - before.x) < 1e-9);
  assert.ok(Math.abs(after.y - before.y) < 1e-9);
  assert.ok(cam.z > 16);
});

test("pan moves the camera opposite the pointer", () => {
  const cam = { x: 10, y: 10, z: 20 };
  panCam(cam, 40, 0);
  assert.equal(cam.x, 8);
  panCam(cam, 0, -20);
  assert.equal(cam.y, 11);
});
