import { quantizeScreenDirection, type DirectionIndex } from "./direction";

export const OCCASIONAL_ATTENTION_DELAY_MIN_MS = 12_000;
export const OCCASIONAL_ATTENTION_DELAY_MAX_MS = 24_000;
// A random glance should be long enough to read as an intentional pose rather
// than a one-frame flicker, while still remaining an occasional action.
export const OCCASIONAL_ATTENTION_DURATION_MS = 5_000;
// Direction follows the cursor only while an occasional glance or file drag is active.
export const ACTIVE_ATTENTION_POLL_MS = 80;

export function nextOccasionalAttentionDelayMs(
  randomValue = Math.random(),
): number {
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError("randomValue must be finite and in the range [0, 1)");
  }
  return (
    OCCASIONAL_ATTENTION_DELAY_MIN_MS +
    randomValue *
      (OCCASIONAL_ATTENTION_DELAY_MAX_MS - OCCASIONAL_ATTENTION_DELAY_MIN_MS)
  );
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenRect extends ScreenPoint {
  readonly width: number;
  readonly height: number;
}

function assertPositiveSize(size: Pick<ScreenRect, "width" | "height">): void {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new RangeError("attention bounds must have finite positive dimensions");
  }
}

/** Quantizes one global cursor snapshot relative to the pet window center. */
export function attentionDirectionFromGlobalPoint(
  point: ScreenPoint,
  windowBounds: ScreenRect,
  deadZonePx = 0,
): DirectionIndex | null {
  assertPositiveSize(windowBounds);
  return quantizeScreenDirection(
    point.x - (windowBounds.x + windowBounds.width / 2),
    point.y - (windowBounds.y + windowBounds.height / 2),
    deadZonePx,
  );
}
