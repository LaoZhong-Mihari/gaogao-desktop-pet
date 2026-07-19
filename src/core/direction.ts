export type DirectionIndex =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15;

export type DirectionName =
  | "N"
  | "NNE"
  | "NE"
  | "ENE"
  | "E"
  | "ESE"
  | "SE"
  | "SSE"
  | "S"
  | "SSW"
  | "SW"
  | "WSW"
  | "W"
  | "WNW"
  | "NW"
  | "NNW";

export interface DirectionStep {
  readonly index: DirectionIndex;
  readonly degrees: number;
  readonly name: DirectionName;
}

export const DIRECTION_STEP_DEGREES = 22.5;

export const DIRECTION_STEPS: readonly DirectionStep[] = [
  { index: 0, degrees: 0, name: "N" },
  { index: 1, degrees: 22.5, name: "NNE" },
  { index: 2, degrees: 45, name: "NE" },
  { index: 3, degrees: 67.5, name: "ENE" },
  { index: 4, degrees: 90, name: "E" },
  { index: 5, degrees: 112.5, name: "ESE" },
  { index: 6, degrees: 135, name: "SE" },
  { index: 7, degrees: 157.5, name: "SSE" },
  { index: 8, degrees: 180, name: "S" },
  { index: 9, degrees: 202.5, name: "SSW" },
  { index: 10, degrees: 225, name: "SW" },
  { index: 11, degrees: 247.5, name: "WSW" },
  { index: 12, degrees: 270, name: "W" },
  { index: 13, degrees: 292.5, name: "WNW" },
  { index: 14, degrees: 315, name: "NW" },
  { index: 15, degrees: 337.5, name: "NNW" },
] as const;

export function normalizeDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    throw new RangeError("degrees must be finite");
  }
  return ((degrees % 360) + 360) % 360;
}

/** Quantizes a clockwise-from-screen-up angle into one of 16 sectors. */
export function directionIndexFromDegrees(degrees: number): DirectionIndex {
  const normalized = normalizeDegrees(degrees);
  const index =
    Math.floor((normalized + DIRECTION_STEP_DEGREES / 2) / DIRECTION_STEP_DEGREES) %
    DIRECTION_STEPS.length;
  return index as DirectionIndex;
}

/** Returns a clockwise-from-up angle for a screen-space vector. */
export function degreesFromScreenVector(deltaX: number, deltaY: number): number | null {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null;
  if (deltaX === 0 && deltaY === 0) return null;
  return normalizeDegrees((Math.atan2(deltaX, -deltaY) * 180) / Math.PI);
}

/** Quantizes a screen vector; a zero or dead-zone vector has no look pose. */
export function quantizeScreenDirection(
  deltaX: number,
  deltaY: number,
  deadZonePx = 0,
): DirectionIndex | null {
  if (!Number.isFinite(deadZonePx) || deadZonePx < 0) {
    throw new RangeError("deadZonePx must be a finite non-negative number");
  }
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null;
  if (Math.hypot(deltaX, deltaY) <= deadZonePx) return null;
  const degrees = degreesFromScreenVector(deltaX, deltaY);
  return degrees === null ? null : directionIndexFromDegrees(degrees);
}

export function getDirectionStep(index: DirectionIndex): DirectionStep {
  return DIRECTION_STEPS[index];
}

export function oppositeDirection(index: DirectionIndex): DirectionIndex {
  return ((index + 8) % DIRECTION_STEPS.length) as DirectionIndex;
}
