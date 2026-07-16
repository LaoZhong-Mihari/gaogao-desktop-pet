import { animationDurationMs, type BaseAnimationId, type PetManifest } from "./manifest";

export const GROOMING_REPEAT_COUNT = 4;

/** Keeps looping actions active for a deliberate number of complete cycles. */
export function actionHoldDurationMs(
  manifest: PetManifest,
  animationId: BaseAnimationId,
): number {
  const cycleDuration = animationDurationMs(manifest, animationId);
  return animationId === "grooming"
    ? cycleDuration * GROOMING_REPEAT_COUNT
    : cycleDuration;
}
