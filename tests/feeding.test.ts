import { describe, expect, it } from "vitest";

import {
  MAX_FEED_GROWTH,
  MIN_FEED_GROWTH,
  bottomCenterAnchoredPosition,
  effectivePetScale,
  feedingGrowthFromRandom,
  hasFeedingGrowth,
  nextGrowthBonus,
  resetFeedingGrowth,
  singleDroppedPath,
} from "../src/core/feeding";
import { MAX_GROWTH_BONUS } from "../src/core/settings";

describe("feeding growth", () => {
  it("accepts one dropped file without using unreliable drag coordinates", () => {
    expect(singleDroppedPath(["/Users/me/Desktop/cat-treat.png"])).toBe(
      "/Users/me/Desktop/cat-treat.png",
    );
    expect(singleDroppedPath([])).toBeNull();
    expect(singleDroppedPath(["a", "b"])).toBeNull();
    expect(singleDroppedPath(["  "])).toBeNull();
  });

  it("maps random values to a 2–5% growth increment", () => {
    expect(feedingGrowthFromRandom(0)).toBe(MIN_FEED_GROWTH);
    expect(feedingGrowthFromRandom(0.999_999)).toBeCloseTo(MAX_FEED_GROWTH, 5);
    expect(() => feedingGrowthFromRandom(1)).toThrow(RangeError);
    expect(() => feedingGrowthFromRandom(Number.NaN)).toThrow(RangeError);
  });

  it("accumulates growth and clamps it at 50%", () => {
    expect(nextGrowthBonus(0.1, 0)).toBeCloseTo(0.12);
    expect(nextGrowthBonus(0.49, 0.999)).toBe(MAX_GROWTH_BONUS);
    expect(nextGrowthBonus(MAX_GROWTH_BONUS, 0)).toBe(MAX_GROWTH_BONUS);
  });

  it("combines the selected base size with feeding growth", () => {
    expect(effectivePetScale(1, 0.05)).toBeCloseTo(1.05);
    expect(effectivePetScale(1.5, 0.5)).toBeCloseTo(2.25);
    expect(effectivePetScale(0.75, -1)).toBe(0.75);
  });

  it("restores only feeding growth, leaving the configured base scale intact", () => {
    expect(hasFeedingGrowth(0)).toBe(false);
    expect(hasFeedingGrowth(0.02)).toBe(true);
    expect(resetFeedingGrowth(0.28)).toBe(0);
    expect(effectivePetScale(1.5, resetFeedingGrowth(0.28))).toBe(1.5);
    expect(() => resetFeedingGrowth(Number.NaN)).toThrow(RangeError);
  });

  it("keeps horizontal center and bottom edge fixed while resizing", () => {
    const current = { x: 100, y: 200, width: 192, height: 208 };
    const nextSize = { width: 202, height: 219 };
    const next = bottomCenterAnchoredPosition(current, nextSize);
    expect(next).toEqual({ x: 95, y: 189 });
    expect(next.x + nextSize.width / 2).toBe(current.x + current.width / 2);
    expect(next.y + nextSize.height).toBe(current.y + current.height);
  });

  it("rejects malformed window geometry", () => {
    expect(() =>
      bottomCenterAnchoredPosition(
        { x: 0, y: 0, width: 0, height: 100 },
        { width: 100, height: 100 },
      ),
    ).toThrow(RangeError);
  });
});
