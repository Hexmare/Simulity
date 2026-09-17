export const ZOOM_MIN = 8;
export const ZOOM_MAX = 48;
export const ZOOM_CITY = 16;
export const ZOOM_INTERIOR = 32;
export const PAN_THRESHOLD = 8;

export interface Cam {
  x: number;
  y: number;
  z: number;
}

export function clampZoom(z: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

export function screenToWorld(cam: Cam, screenX: number, screenY: number, viewW: number, viewH: number) {
  return {
    x: (screenX - viewW / 2) / cam.z + cam.x,
    y: (screenY - viewH / 2) / cam.z + cam.y,
  };
}

export function zoomToward(cam: Cam, screenX: number, screenY: number, viewW: number, viewH: number, factor: number) {
  const world = screenToWorld(cam, screenX, screenY, viewW, viewH);
  cam.z = clampZoom(cam.z * factor);
  cam.x = world.x - (screenX - viewW / 2) / cam.z;
  cam.y = world.y - (screenY - viewH / 2) / cam.z;
}

export function panCam(cam: Cam, dxPx: number, dyPx: number) {
  cam.x -= dxPx / cam.z;
  cam.y -= dyPx / cam.z;
}

export function followToward(cam: Cam, px: number, py: number, k = 0.12) {
  cam.x += (px - cam.x) * k;
  cam.y += (py - cam.y) * k;
}
