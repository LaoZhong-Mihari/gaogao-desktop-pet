export const OCCASIONAL_ATTENTION_DELAY_MIN_MS = 12_000;
export const OCCASIONAL_ATTENTION_DELAY_MAX_MS = 24_000;
export const OCCASIONAL_ATTENTION_DURATION_MS = 2_600;

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
