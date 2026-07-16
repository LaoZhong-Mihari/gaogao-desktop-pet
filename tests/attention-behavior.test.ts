import { describe, expect, it } from "vitest";

import {
  OCCASIONAL_ATTENTION_DELAY_MAX_MS,
  OCCASIONAL_ATTENTION_DELAY_MIN_MS,
  OCCASIONAL_ATTENTION_DURATION_MS,
  nextOccasionalAttentionDelayMs,
} from "../src/core/attention-behavior";

describe("occasional attention behavior", () => {
  it("makes the original review pose observable without directional face art", () => {
    expect(nextOccasionalAttentionDelayMs(0)).toBe(
      OCCASIONAL_ATTENTION_DELAY_MIN_MS,
    );
    expect(nextOccasionalAttentionDelayMs(0.999_999)).toBeGreaterThan(
      OCCASIONAL_ATTENTION_DELAY_MAX_MS - 1,
    );
    expect(OCCASIONAL_ATTENTION_DURATION_MS).toBe(2_600);
    expect(() => nextOccasionalAttentionDelayMs(1)).toThrow(RangeError);
  });
});
