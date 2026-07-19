import { describe, expect, it } from "vitest";

import {
  DIRECTION_STEPS,
  degreesFromScreenVector,
  directionIndexFromDegrees,
  normalizeDegrees,
  oppositeDirection,
  quantizeScreenDirection,
} from "../src/core/direction";

describe("16-way screen directions", () => {
  it("keeps the fixed clockwise order starting at screen-up", () => {
    expect(DIRECTION_STEPS).toHaveLength(16);
    expect(DIRECTION_STEPS.map(({ degrees }) => degrees)).toEqual([
      0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5,
      180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5,
    ]);
  });

  it("maps the four screen-space cardinal vectors", () => {
    expect(quantizeScreenDirection(0, -100)).toBe(0);
    expect(quantizeScreenDirection(100, 0)).toBe(4);
    expect(quantizeScreenDirection(0, 100)).toBe(8);
    expect(quantizeScreenDirection(-100, 0)).toBe(12);
  });

  it("rounds sector boundaries clockwise and wraps negative angles", () => {
    expect(directionIndexFromDegrees(11.249)).toBe(0);
    expect(directionIndexFromDegrees(11.25)).toBe(1);
    expect(directionIndexFromDegrees(348.749)).toBe(15);
    expect(directionIndexFromDegrees(348.75)).toBe(0);
    expect(directionIndexFromDegrees(-90)).toBe(12);
    expect(normalizeDegrees(720 + 22.5)).toBe(22.5);
  });

  it("uses a dead zone and rejects invalid inputs safely", () => {
    expect(quantizeScreenDirection(3, 4, 5)).toBeNull();
    expect(quantizeScreenDirection(3, 4, 4.99)).not.toBeNull();
    expect(quantizeScreenDirection(Number.NaN, 0)).toBeNull();
    expect(() => quantizeScreenDirection(1, 1, -1)).toThrow(RangeError);
    expect(degreesFromScreenVector(0, 0)).toBeNull();
  });

  it("returns exact opposite sectors", () => {
    expect(oppositeDirection(0)).toBe(8);
    expect(oppositeDirection(4)).toBe(12);
    expect(oppositeDirection(15)).toBe(7);
  });
});
