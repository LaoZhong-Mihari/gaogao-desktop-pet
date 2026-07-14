export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Point, Size {}

export interface DisplayWorkArea extends Rect {
  readonly id: string;
}

export type HorizontalDirection = -1 | 1;

export interface RoamPlan {
  readonly durationMs: number;
  readonly direction: HorizontalDirection;
}

export interface RoamStep {
  readonly position: Point;
  readonly direction: HorizontalDirection;
  readonly bounced: boolean;
}

export const MIN_ROAM_DURATION_MS = 4_000;
export const MAX_ROAM_DURATION_MS = 10_000;

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

function requireNonNegative(value: number, name: string): void {
  requireFinite(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must not be negative`);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function axisBounds(origin: number, span: number, itemSpan: number, margin: number): {
  minimum: number;
  maximum: number;
} {
  const minimum = origin + margin;
  const maximum = origin + span - itemSpan - margin;
  if (maximum < minimum) {
    const centered = origin + (span - itemSpan) / 2;
    return { minimum: centered, maximum: centered };
  }
  return { minimum, maximum };
}

function validateGeometry(size: Size, workArea: Rect, margin: number): void {
  requireNonNegative(size.width, "size.width");
  requireNonNegative(size.height, "size.height");
  requireNonNegative(workArea.width, "workArea.width");
  requireNonNegative(workArea.height, "workArea.height");
  requireNonNegative(margin, "margin");
  requireFinite(workArea.x, "workArea.x");
  requireFinite(workArea.y, "workArea.y");
}

export function clampWindowPosition(
  position: Point,
  windowSize: Size,
  workArea: Rect,
  margin = 0,
): Point {
  validateGeometry(windowSize, workArea, margin);
  requireFinite(position.x, "position.x");
  requireFinite(position.y, "position.y");
  const horizontal = axisBounds(workArea.x, workArea.width, windowSize.width, margin);
  const vertical = axisBounds(workArea.y, workArea.height, windowSize.height, margin);
  return {
    x: clamp(position.x, horizontal.minimum, horizontal.maximum),
    y: clamp(position.y, vertical.minimum, vertical.maximum),
  };
}

export function groundedWindowPosition(
  x: number,
  windowSize: Size,
  workArea: Rect,
  margin = 0,
): Point {
  const clamped = clampWindowPosition({ x, y: workArea.y }, windowSize, workArea, margin);
  const vertical = axisBounds(workArea.y, workArea.height, windowSize.height, margin);
  return { x: clamped.x, y: vertical.maximum };
}

export function intersectionArea(left: Rect, right: Rect): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return width * height;
}

function squaredCenterDistance(rect: Rect, area: Rect): number {
  const rectCenterX = rect.x + rect.width / 2;
  const rectCenterY = rect.y + rect.height / 2;
  const areaCenterX = area.x + area.width / 2;
  const areaCenterY = area.y + area.height / 2;
  return (rectCenterX - areaCenterX) ** 2 + (rectCenterY - areaCenterY) ** 2;
}

/**
 * Picks the saved monitor when available, otherwise the monitor with greatest
 * overlap. Completely off-screen windows are assigned to the nearest monitor.
 */
export function selectWorkArea(
  position: Point,
  windowSize: Size,
  workAreas: readonly DisplayWorkArea[],
  preferredMonitorId?: string,
): DisplayWorkArea {
  if (workAreas.length === 0) {
    throw new RangeError("At least one work area is required");
  }
  if (preferredMonitorId !== undefined) {
    const preferred = workAreas.find((area) => area.id === preferredMonitorId);
    if (preferred !== undefined) {
      return preferred;
    }
  }

  const windowRect: Rect = { ...position, ...windowSize };
  let selected = workAreas[0];
  let selectedOverlap = intersectionArea(windowRect, selected);
  let selectedDistance = squaredCenterDistance(windowRect, selected);
  for (const area of workAreas.slice(1)) {
    const overlap = intersectionArea(windowRect, area);
    const distance = squaredCenterDistance(windowRect, area);
    if (
      overlap > selectedOverlap ||
      (overlap === selectedOverlap && distance < selectedDistance)
    ) {
      selected = area;
      selectedOverlap = overlap;
      selectedDistance = distance;
    }
  }
  return selected;
}

export function restoreVisiblePosition(
  position: Point,
  windowSize: Size,
  workAreas: readonly DisplayWorkArea[],
  preferredMonitorId?: string,
  margin = 0,
): { readonly position: Point; readonly workArea: DisplayWorkArea } {
  const workArea = selectWorkArea(position, windowSize, workAreas, preferredMonitorId);
  return {
    position: clampWindowPosition(position, windowSize, workArea, margin),
    workArea,
  };
}

function normalizedRandom(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) {
    return 0;
  }
  return clamp(value, 0, 1 - Number.EPSILON);
}

export function createRoamPlan(random: () => number = Math.random): RoamPlan {
  const durationRatio = normalizedRandom(random);
  const directionRatio = normalizedRandom(random);
  return {
    durationMs: Math.round(
      MIN_ROAM_DURATION_MS +
        durationRatio * (MAX_ROAM_DURATION_MS - MIN_ROAM_DURATION_MS),
    ),
    direction: directionRatio < 0.5 ? -1 : 1,
  };
}

/** Advances bottom-edge roaming and reflects cleanly when a display edge is hit. */
export function stepHorizontalRoam(options: {
  readonly position: Point;
  readonly direction: HorizontalDirection;
  readonly speedPxPerSecond: number;
  readonly elapsedMs: number;
  readonly windowSize: Size;
  readonly workArea: Rect;
  readonly margin?: number;
}): RoamStep {
  const margin = options.margin ?? 0;
  validateGeometry(options.windowSize, options.workArea, margin);
  requireNonNegative(options.speedPxPerSecond, "speedPxPerSecond");
  requireNonNegative(options.elapsedMs, "elapsedMs");
  requireFinite(options.position.x, "position.x");

  const bounds = axisBounds(
    options.workArea.x,
    options.workArea.width,
    options.windowSize.width,
    margin,
  );
  let x = clamp(options.position.x, bounds.minimum, bounds.maximum);
  let direction = options.direction;
  const range = bounds.maximum - bounds.minimum;
  const fullDistance = (options.speedPxPerSecond * options.elapsedMs) / 1_000;
  if (range === 0 || fullDistance === 0) {
    return {
      position: groundedWindowPosition(x, options.windowSize, options.workArea, margin),
      direction,
      bounced: false,
    };
  }

  let remaining = fullDistance % (range * 2);
  let bounced = fullDistance >= range * 2;
  while (remaining > 0) {
    const edge = direction === 1 ? bounds.maximum : bounds.minimum;
    const distanceToEdge = Math.abs(edge - x);
    if (distanceToEdge === 0) {
      direction = direction === 1 ? -1 : 1;
      bounced = true;
      continue;
    }
    if (remaining < distanceToEdge) {
      x += direction * remaining;
      remaining = 0;
    } else {
      x = edge;
      remaining -= distanceToEdge;
      direction = direction === 1 ? -1 : 1;
      bounced = true;
    }
  }

  return {
    position: groundedWindowPosition(x, options.windowSize, options.workArea, margin),
    direction,
    bounced,
  };
}
