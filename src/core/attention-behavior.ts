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

export interface AttentionDirectionOptions {
  /** Unit coordinates inside the pet window, normally centered on the face. */
  readonly anchorRatio?: ScreenPoint;
  readonly deadZonePx?: number;
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

function attentionAnchorPoint(
  windowBounds: ScreenRect,
  anchorRatio: ScreenPoint,
): ScreenPoint {
  if (
    !Number.isFinite(anchorRatio.x) ||
    !Number.isFinite(anchorRatio.y) ||
    anchorRatio.x < 0 ||
    anchorRatio.x > 1 ||
    anchorRatio.y < 0 ||
    anchorRatio.y > 1
  ) {
    throw new RangeError("attention anchor ratio must stay inside the window");
  }
  return {
    x: windowBounds.x + windowBounds.width * anchorRatio.x,
    y: windowBounds.y + windowBounds.height * anchorRatio.y,
  };
}

/** Quantizes one global cursor snapshot relative to Gaogao's face anchor. */
export function attentionDirectionFromGlobalPoint(
  point: ScreenPoint,
  windowBounds: ScreenRect,
  options: AttentionDirectionOptions = {},
): DirectionIndex | null {
  assertPositiveSize(windowBounds);
  const anchor = attentionAnchorPoint(
    windowBounds,
    options.anchorRatio ?? { x: 0.5, y: 0.5 },
  );
  return quantizeScreenDirection(
    point.x - anchor.x,
    point.y - anchor.y,
    options.deadZonePx ?? 0,
  );
}
