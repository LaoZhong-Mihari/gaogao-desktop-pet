import { describe, expect, it } from "vitest";

import {
  DIRECTION_STEPS,
  degreesFromScreenVector,
  directionIndexFromDegrees,
  normalizeDegrees,
  oppositeDirection,
  quantizeScreenDirection,
} from "../src/core/direction";

describe("16-direction quantization", () => {
  it("maps every sector center clockwise from screen-up", () => {
    for (const step of DIRECTION_STEPS) {
      const radians = (step.degrees * Math.PI) / 180;
      const deltaX = Math.sin(radians) * 100;
      const deltaY = -Math.cos(radians) * 100;
      expect(quantizeScreenDirection(deltaX, deltaY)).toBe(step.index);
      expect(directionIndexFromDegrees(step.degrees)).toBe(step.index);
    }
  });

  it("uses screen coordinates for the four cardinals", () => {
    expect(quantizeScreenDirection(0, -1)).toBe(0);
    expect(quantizeScreenDirection(1, 0)).toBe(4);
    expect(quantizeScreenDirection(0, 1)).toBe(8);
    expect(quantizeScreenDirection(-1, 0)).toBe(12);
  });

  it("switches sectors at the half-step boundary", () => {
    expect(directionIndexFromDegrees(11.25 - 0.001)).toBe(0);
    expect(directionIndexFromDegrees(11.25)).toBe(1);
    expect(directionIndexFromDegrees(11.25 + 0.001)).toBe(1);
    expect(directionIndexFromDegrees(348.75 - 0.001)).toBe(15);
    expect(directionIndexFromDegrees(348.75)).toBe(0);
  });

  it("normalizes wrapped angles and reports opposite sectors", () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(directionIndexFromDegrees(450)).toBe(4);
    expect(oppositeDirection(0)).toBe(8);
    expect(oppositeDirection(13)).toBe(5);
  });

  it("keeps the previous pose for zero, invalid, or dead-zone vectors", () => {
    expect(degreesFromScreenVector(0, 0)).toBeNull();
    expect(quantizeScreenDirection(0, 0)).toBeNull();
    expect(quantizeScreenDirection(3, 4, 5)).toBeNull();
    expect(quantizeScreenDirection(Number.NaN, 1)).toBeNull();
    expect(() => quantizeScreenDirection(1, 1, -1)).toThrow(RangeError);
  });
});
