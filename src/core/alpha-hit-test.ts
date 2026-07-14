import type { PixelRect } from "./manifest";
import type { Point, Rect } from "./roaming";

export interface RgbaPixelBuffer {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

export interface AlphaMask {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_ALPHA_THRESHOLD = 16;

function validateThreshold(threshold: number): void {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new RangeError("alpha threshold must be an integer from 0 to 255");
  }
}

function validatePixelRect(rect: PixelRect): void {
  if (
    !Number.isInteger(rect.x) ||
    !Number.isInteger(rect.y) ||
    !Number.isInteger(rect.width) ||
    !Number.isInteger(rect.height) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new RangeError("source frame must use positive integer pixel geometry");
  }
}

function validateDestination(rect: Rect): void {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new RangeError("destination must have finite positive geometry");
  }
}

function validateRgbaBuffer(buffer: RgbaPixelBuffer): void {
  if (
    !Number.isInteger(buffer.width) ||
    !Number.isInteger(buffer.height) ||
    buffer.width <= 0 ||
    buffer.height <= 0
  ) {
    throw new RangeError("RGBA buffer dimensions must be positive integers");
  }
  if (buffer.data.length < buffer.width * buffer.height * 4) {
    throw new RangeError("RGBA buffer is shorter than its declared dimensions");
  }
}

/** Maps a CSS/window-space point into an atlas pixel. Rect right/bottom edges are exclusive. */
export function mapPointToSourcePixel(
  point: Point,
  destination: Rect,
  sourceFrame: PixelRect,
): Point | null {
  validateDestination(destination);
  validatePixelRect(sourceFrame);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return null;
  }
  if (
    point.x < destination.x ||
    point.y < destination.y ||
    point.x >= destination.x + destination.width ||
    point.y >= destination.y + destination.height
  ) {
    return null;
  }

  const relativeX = (point.x - destination.x) / destination.width;
  const relativeY = (point.y - destination.y) / destination.height;
  return {
    x: sourceFrame.x + Math.min(sourceFrame.width - 1, Math.floor(relativeX * sourceFrame.width)),
    y:
      sourceFrame.y + Math.min(sourceFrame.height - 1, Math.floor(relativeY * sourceFrame.height)),
  };
}

export function isRgbaPixelOpaque(
  buffer: RgbaPixelBuffer,
  x: number,
  y: number,
  threshold = DEFAULT_ALPHA_THRESHOLD,
): boolean {
  validateRgbaBuffer(buffer);
  validateThreshold(threshold);
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= buffer.width ||
    y >= buffer.height
  ) {
    return false;
  }
  return buffer.data[(y * buffer.width + x) * 4 + 3] >= threshold;
}

export function hitTestRgbaFrame(options: {
  readonly point: Point;
  readonly destination: Rect;
  readonly sourceFrame: PixelRect;
  readonly atlas: RgbaPixelBuffer;
  readonly threshold?: number;
}): boolean {
  const sourcePoint = mapPointToSourcePixel(
    options.point,
    options.destination,
    options.sourceFrame,
  );
  if (sourcePoint === null) {
    return false;
  }
  return isRgbaPixelOpaque(
    options.atlas,
    sourcePoint.x,
    sourcePoint.y,
    options.threshold,
  );
}

/** Extracts a reusable single-frame mask so pointer moves avoid RGBA decoding work. */
export function extractAlphaMask(
  atlas: RgbaPixelBuffer,
  sourceFrame: PixelRect,
): AlphaMask {
  validateRgbaBuffer(atlas);
  validatePixelRect(sourceFrame);
  if (
    sourceFrame.x + sourceFrame.width > atlas.width ||
    sourceFrame.y + sourceFrame.height > atlas.height
  ) {
    throw new RangeError("source frame is outside the RGBA buffer");
  }

  const data = new Uint8Array(sourceFrame.width * sourceFrame.height);
  for (let y = 0; y < sourceFrame.height; y += 1) {
    for (let x = 0; x < sourceFrame.width; x += 1) {
      const sourceIndex =
        ((sourceFrame.y + y) * atlas.width + sourceFrame.x + x) * 4 + 3;
      data[y * sourceFrame.width + x] = atlas.data[sourceIndex];
    }
  }
  return { data, width: sourceFrame.width, height: sourceFrame.height };
}

export function hitTestAlphaMask(
  mask: AlphaMask,
  point: Point,
  destination: Rect,
  threshold = DEFAULT_ALPHA_THRESHOLD,
): boolean {
  validateThreshold(threshold);
  if (
    !Number.isInteger(mask.width) ||
    !Number.isInteger(mask.height) ||
    mask.width <= 0 ||
    mask.height <= 0 ||
    mask.data.length < mask.width * mask.height
  ) {
    throw new RangeError("alpha mask dimensions are invalid");
  }

  const sourcePoint = mapPointToSourcePixel(point, destination, {
    x: 0,
    y: 0,
    width: mask.width,
    height: mask.height,
  });
  if (sourcePoint === null) {
    return false;
  }
  return mask.data[sourcePoint.y * mask.width + sourcePoint.x] >= threshold;
}
