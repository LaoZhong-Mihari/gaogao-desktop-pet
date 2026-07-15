import { describe, expect, it } from "vitest";

import {
  AMBIENT_ANIMATION_IDS,
  pickAmbientAnimation,
} from "../src/core/ambient";

describe("ambient animations", () => {
  it("includes grooming as a random idle action", () => {
    expect(AMBIENT_ANIMATION_IDS).toEqual([
      "waiting",
      "review",
      "running",
      "failed",
      "grooming",
    ]);
  });

  it("maps the random range from its first through final choice", () => {
    expect(pickAmbientAnimation(0)).toBe("waiting");
    expect(pickAmbientAnimation(0.999)).toBe("grooming");
  });

  it("rejects values outside Math.random's range", () => {
    expect(() => pickAmbientAnimation(1)).toThrow(RangeError);
    expect(() => pickAmbientAnimation(Number.NaN)).toThrow(RangeError);
  });
});
