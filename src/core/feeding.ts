import { MAX_GROWTH_BONUS, type PetScale } from "./settings";

export const MIN_FEED_GROWTH = 0.02;
export const MAX_FEED_GROWTH = 0.05;

export interface PositionedSize {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Accepts one dropped file path without depending on platform drag coordinates. */
export function singleDroppedPath(paths: readonly string[]): string | null {
  if (paths.length !== 1) return null;
  const path = paths[0];
  return typeof path === "string" && path.trim() !== "" ? path : null;
}

function assertUnitRandom(randomValue: number): void {
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError("randomValue must be finite and in the range [0, 1)");
  }
}

export function feedingGrowthFromRandom(randomValue = Math.random()): number {
  assertUnitRandom(randomValue);
  return MIN_FEED_GROWTH + randomValue * (MAX_FEED_GROWTH - MIN_FEED_GROWTH);
}

export function nextGrowthBonus(
  currentBonus: number,
  randomValue = Math.random(),
): number {
  if (!Number.isFinite(currentBonus)) {
    throw new RangeError("currentBonus must be finite");
  }
  const safeCurrent = Math.min(MAX_GROWTH_BONUS, Math.max(0, currentBonus));
  return Math.min(
    MAX_GROWTH_BONUS,
    safeCurrent + feedingGrowthFromRandom(randomValue),
  );
}

export function effectivePetScale(baseScale: PetScale, growthBonus: number): number {
  if (!Number.isFinite(growthBonus)) {
    throw new RangeError("growthBonus must be finite");
  }
  return baseScale * (1 + Math.min(MAX_GROWTH_BONUS, Math.max(0, growthBonus)));
}

/** Returns a new top-left position while preserving horizontal center and bottom edge. */
export function bottomCenterAnchoredPosition(
  current: PositionedSize,
  nextSize: Size,
): { readonly x: number; readonly y: number } {
  const values = [
    current.x,
    current.y,
    current.width,
    current.height,
    nextSize.width,
    nextSize.height,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new RangeError("window geometry must contain only finite values");
  }
  if (
    current.width <= 0 ||
    current.height <= 0 ||
    nextSize.width <= 0 ||
    nextSize.height <= 0
  ) {
    throw new RangeError("window dimensions must be positive");
  }
  return {
    x: current.x + (current.width - nextSize.width) / 2,
    y: current.y + current.height - nextSize.height,
  };
}
