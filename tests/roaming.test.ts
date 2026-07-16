import { describe, expect, it } from "vitest";

import {
  clampWindowPosition,
  createRoamPlan,
  groundedWindowPosition,
  restoreVisiblePosition,
  selectWorkArea,
  stepHorizontalRoam,
  type DisplayWorkArea,
} from "../src/core/roaming";

const displays: readonly DisplayWorkArea[] = [
  { id: "left", x: -1280, y: 0, width: 1280, height: 720 },
  { id: "main", x: 0, y: 0, width: 1920, height: 1080 },
] as const;

describe("roaming geometry", () => {
  it("clamps windows fully inside work areas, including negative coordinates", () => {
    expect(
      clampWindowPosition(
        { x: -1500, y: 900 },
        { width: 200, height: 100 },
        displays[0],
      ),
    ).toEqual({ x: -1280, y: 620 });
    expect(
      groundedWindowPosition(1900, { width: 200, height: 100 }, displays[1], 10),
    ).toEqual({ x: 1710, y: 970 });
  });

  it("centers an oversized window instead of producing invalid bounds", () => {
    expect(
      clampWindowPosition(
        { x: 999, y: 999 },
        { width: 600, height: 500 },
        { x: 0, y: 0, width: 400, height: 300 },
      ),
    ).toEqual({ x: -100, y: -100 });
  });

  it("selects the monitor with greatest overlap after a drag", () => {
    expect(selectWorkArea({ x: -200, y: 100 }, { width: 300, height: 300 }, displays).id).toBe(
      "left",
    );
    expect(selectWorkArea({ x: 100, y: 100 }, { width: 300, height: 300 }, displays).id).toBe(
      "main",
    );
  });

  it("restores onto a preferred monitor and guarantees visibility", () => {
    expect(
      restoreVisiblePosition(
        { x: 9000, y: 9000 },
        { width: 200, height: 100 },
        displays,
        "left",
      ),
    ).toEqual({
      workArea: displays[0],
      position: { x: -200, y: 620 },
    });
    expect(
      restoreVisiblePosition(
        { x: 9000, y: 9000 },
        { width: 200, height: 100 },
        displays,
        "missing",
      ).workArea.id,
    ).toBe("main");
  });

  it("creates deterministic 4-10 second roam plans", () => {
    const values = [0, 0.49, 1, 0.5];
    const random = () => values.shift() ?? 0;
    expect(createRoamPlan(random)).toEqual({ durationMs: 4000, direction: -1 });
    expect(createRoamPlan(random)).toEqual({ durationMs: 10000, direction: 1 });
  });

  it("moves horizontally at the current height and reflects at bounds", () => {
    const workArea = { x: 0, y: 0, width: 500, height: 400 };
    const windowSize = { width: 100, height: 100 };
    expect(
      stepHorizontalRoam({
        position: { x: 100, y: 80 },
        direction: 1,
        speedPxPerSecond: 50,
        elapsedMs: 1000,
        windowSize,
        workArea,
      }),
    ).toEqual({ position: { x: 150, y: 80 }, direction: 1, bounced: false });

    expect(
      stepHorizontalRoam({
        position: { x: 390, y: 80 },
        direction: 1,
        speedPxPerSecond: 20,
        elapsedMs: 1000,
        windowSize,
        workArea,
      }),
    ).toEqual({ position: { x: 390, y: 80 }, direction: -1, bounced: true });
  });

  it("handles a large time step without escaping or stalling", () => {
    const result = stepHorizontalRoam({
      position: { x: 50, y: 160 },
      direction: -1,
      speedPxPerSecond: 10_000,
      elapsedMs: 60_000,
      windowSize: { width: 100, height: 100 },
      workArea: { x: 0, y: 0, width: 500, height: 400 },
    });
    expect(result.position.x).toBeGreaterThanOrEqual(0);
    expect(result.position.x).toBeLessThanOrEqual(400);
    expect(result.position.y).toBe(160);
  });

  it("only clamps an invalid height instead of forcing the bottom edge", () => {
    const result = stepHorizontalRoam({
      position: { x: -1200, y: -100 },
      direction: 1,
      speedPxPerSecond: 0,
      elapsedMs: 100,
      windowSize: { width: 200, height: 100 },
      workArea: displays[0],
      margin: 10,
    });
    expect(result.position).toEqual({ x: -1200, y: 10 });
  });
});
