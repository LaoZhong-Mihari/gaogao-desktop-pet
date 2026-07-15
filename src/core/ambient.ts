import type { BaseAnimationId } from "./manifest";

export const AMBIENT_ANIMATION_IDS = [
  "waiting",
  "review",
  "running",
  "failed",
  "grooming",
] as const satisfies readonly BaseAnimationId[];

export type AmbientAnimationId = (typeof AMBIENT_ANIMATION_IDS)[number];

export function pickAmbientAnimation(randomValue = Math.random()): AmbientAnimationId {
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError("randomValue must be finite and in the range [0, 1)");
  }
  return AMBIENT_ANIMATION_IDS[Math.floor(randomValue * AMBIENT_ANIMATION_IDS.length)]!;
}
