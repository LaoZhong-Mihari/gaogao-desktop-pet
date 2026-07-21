import { describe, expect, it } from "vitest";

import {
  OCCASIONAL_ATTENTION_DELAY_MAX_MS,
  OCCASIONAL_ATTENTION_DELAY_MIN_MS,
  OCCASIONAL_ATTENTION_DURATION_MS,
  ACTIVE_ATTENTION_POLL_MS,
  attentionDirectionFromGlobalPoint,
  nextOccasionalAttentionDelayMs,
} from "../src/core/attention-behavior";

describe("occasional attention behavior", () => {
  it("schedules a bounded occasional tracking window", () => {
    expect(nextOccasionalAttentionDelayMs(0)).toBe(
      OCCASIONAL_ATTENTION_DELAY_MIN_MS,
    );
    expect(nextOccasionalAttentionDelayMs(0.999_999)).toBeGreaterThan(
      OCCASIONAL_ATTENTION_DELAY_MAX_MS - 1,
    );
    expect(OCCASIONAL_ATTENTION_DURATION_MS).toBe(5_000);
    expect(ACTIVE_ATTENTION_POLL_MS).toBe(80);
    expect(() => nextOccasionalAttentionDelayMs(1)).toThrow(RangeError);
  });

  it("quantizes one global cursor snapshot around the physical window center", () => {
    const bounds = { x: 100, y: 200, width: 200, height: 200 };
    expect(attentionDirectionFromGlobalPoint({ x: 200, y: 0 }, bounds)).toBe(0);
    expect(attentionDirectionFromGlobalPoint({ x: 500, y: 300 }, bounds)).toBe(4);
    expect(attentionDirectionFromGlobalPoint({ x: 200, y: 600 }, bounds)).toBe(8);
    expect(attentionDirectionFromGlobalPoint({ x: 0, y: 300 }, bounds)).toBe(12);
  });

  it("rejects non-positive attention bounds", () => {
    expect(() =>
      attentionDirectionFromGlobalPoint(
        { x: 0, y: 0 },
        { x: 0, y: 0, width: 0, height: 208 },
      ),
    ).toThrow(RangeError);
  });
});
