import { cameraRect, type CanvasCamera } from './viewport-ranges.ts';
import type { CanvasRect } from './spatial-index.ts';

export type CanvasDetail = 'summary' | 'detail';
export interface CameraMotion {
  moving: boolean;
  fast: boolean;
  aheadX: number;
  aheadY: number;
  settleAt: number | null;
}

/** Monotonic time is supplied by the UI; polling does not prolong movement. */
export class CanvasCameraMotion {
  private previous: CanvasCamera | null = null;
  private time = 0;
  private until = 0;
  private fastUntil = 0;
  private vx = 0;
  private vy = 0;

  sample(camera: CanvasCamera, now: number): CameraMotion {
    const old = this.previous;
    if (
      old &&
      (old.x !== camera.x || old.y !== camera.y || old.zoom !== camera.zoom)
    ) {
      const before = cameraRect(old),
        after = cameraRect(camera);
      const dt = Math.max(8, Math.min(100, now - this.time));
      if (before && after) {
        // Use a fixed screen anchor so window resizing is not interpreted as pan.
        this.vx =
          ((-camera.x / camera.zoom +
            old.width / 2 / camera.zoom -
            (-old.x / old.zoom + old.width / 2 / old.zoom)) *
            camera.zoom) /
          dt;
        this.vy =
          ((-camera.y / camera.zoom +
            old.height / 2 / camera.zoom -
            (-old.y / old.zoom + old.height / 2 / old.zoom)) *
            camera.zoom) /
          dt;
        const scaleSpeed = Math.abs(Math.log(camera.zoom / old.zoom)) / dt;
        if (Math.hypot(this.vx, this.vy) > 0.9 || scaleSpeed > 0.002)
          this.fastUntil = now + 160;
        this.until = now + 160;
      }
    }
    if (
      !old ||
      old.x !== camera.x ||
      old.y !== camera.y ||
      old.zoom !== camera.zoom
    )
      this.time = now;
    this.previous = { ...camera };
    const moving = now < this.until;
    return {
      moving,
      fast: moving && now < this.fastUntil,
      aheadX: moving ? Math.max(-512, Math.min(512, this.vx * 120)) : 0,
      aheadY: moving ? Math.max(-512, Math.min(512, this.vy * 120)) : 0,
      settleAt: moving ? this.until : null,
    };
  }
}

/** Hysteresis considers both zoom and the actual projected card footprint. */
export function canvasDetail(
  previous: CanvasDetail | undefined,
  zoom: number,
  rect: CanvasRect,
): CanvasDetail {
  const pixels = Math.max(rect.width, rect.height) * zoom;
  if (previous === 'detail')
    return zoom < 0.3 || pixels < 120 ? 'summary' : 'detail';
  return zoom >= 0.38 && pixels >= 160 ? 'detail' : 'summary';
}

export interface PreparationTarget {
  id: string;
  level: CanvasDetail;
  priority: 0 | 1 | 2;
  distance: number;
}

export function comparePreparation(a: PreparationTarget, b: PreparationTarget) {
  return (
    a.priority - b.priority ||
    a.distance - b.distance ||
    a.id.localeCompare(b.id)
  );
}
