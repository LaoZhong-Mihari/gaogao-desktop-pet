import { describe, expect, it } from "vitest";

import {
  extractAlphaMask,
  hitTestAlphaMask,
  hitTestRgbaFrame,
  isRgbaPixelOpaque,
  mapPointToSourcePixel,
  type RgbaPixelBuffer,
} from "../src/core/alpha-hit-test";

function makeAtlas(): RgbaPixelBuffer {
  const width = 4;
  const height = 2;
  const data = new Uint8ClampedArray(width * height * 4);
  const setAlpha = (x: number, y: number, alpha: number) => {
    data[(y * width + x) * 4 + 3] = alpha;
  };
  setAlpha(2, 0, 255);
  setAlpha(3, 0, 0);
  setAlpha(2, 1, 10);
  setAlpha(3, 1, 20);
  return { data, width, height };
}

const sourceFrame = { x: 2, y: 0, width: 2, height: 2 } as const;
const destination = { x: 10, y: 20, width: 200, height: 100 } as const;

describe("alpha hit testing", () => {
  it("maps scaled destination points into exact source pixels", () => {
    expect(mapPointToSourcePixel({ x: 10, y: 20 }, destination, sourceFrame)).toEqual({
      x: 2,
      y: 0,
    });
    expect(mapPointToSourcePixel({ x: 109, y: 69 }, destination, sourceFrame)).toEqual({
      x: 2,
      y: 0,
    });
    expect(mapPointToSourcePixel({ x: 110, y: 70 }, destination, sourceFrame)).toEqual({
      x: 3,
      y: 1,
    });
  });

  it("treats right and bottom edges as outside", () => {
    expect(mapPointToSourcePixel({ x: 210, y: 20 }, destination, sourceFrame)).toBeNull();
    expect(mapPointToSourcePixel({ x: 10, y: 120 }, destination, sourceFrame)).toBeNull();
    expect(mapPointToSourcePixel({ x: 9.99, y: 20 }, destination, sourceFrame)).toBeNull();
  });

  it("uses a configurable alpha threshold", () => {
    const atlas = makeAtlas();
    expect(isRgbaPixelOpaque(atlas, 2, 0)).toBe(true);
    expect(isRgbaPixelOpaque(atlas, 2, 1)).toBe(false);
    expect(isRgbaPixelOpaque(atlas, 2, 1, 10)).toBe(true);
    expect(isRgbaPixelOpaque(atlas, -1, 0)).toBe(false);
  });

  it("hit-tests the current frame without letting transparent padding block clicks", () => {
    const atlas = makeAtlas();
    expect(
      hitTestRgbaFrame({
        point: { x: 20, y: 25 },
        destination,
        sourceFrame,
        atlas,
      }),
    ).toBe(true);
    expect(
      hitTestRgbaFrame({
        point: { x: 180, y: 25 },
        destination,
        sourceFrame,
        atlas,
      }),
    ).toBe(false);
    expect(
      hitTestRgbaFrame({
        point: { x: 180, y: 100 },
        destination,
        sourceFrame,
        atlas,
      }),
    ).toBe(true);
  });

  it("extracts reusable per-frame masks with the same hit behavior", () => {
    const mask = extractAlphaMask(makeAtlas(), sourceFrame);
    expect([...mask.data]).toEqual([255, 0, 10, 20]);
    expect(hitTestAlphaMask(mask, { x: 20, y: 25 }, destination)).toBe(true);
    expect(hitTestAlphaMask(mask, { x: 180, y: 25 }, destination)).toBe(false);
    expect(hitTestAlphaMask(mask, { x: 180, y: 100 }, destination)).toBe(true);
  });

  it("rejects malformed buffers and out-of-atlas frames", () => {
    expect(() =>
      isRgbaPixelOpaque({ data: new Uint8Array(1), width: 2, height: 2 }, 0, 0),
    ).toThrow(RangeError);
    expect(() =>
      extractAlphaMask(makeAtlas(), { x: 3, y: 0, width: 2, height: 2 }),
    ).toThrow("outside");
  });
});
