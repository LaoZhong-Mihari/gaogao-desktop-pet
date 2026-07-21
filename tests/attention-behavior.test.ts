import { describe, expect, it } from "vitest";

import {
  OCCASIONAL_ATTENTION_DELAY_MAX_MS,
  OCCASIONAL_ATTENTION_DELAY_MIN_MS,
  OCCASIONAL_ATTENTION_DURATION_MS,
  ACTIVE_ATTENTION_POLL_MS,
  attentionDirectionFromGlobalPoint,
  nextOccasionalAttentionDelayMs,
} from "../src/core/attention-behavior";
import { DIRECTION_STEPS } from "../src/core/direction";

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

  it("keeps the window center as the default origin", () => {
    const bounds = { x: 100, y: 200, width: 200, height: 200 };
    expect(attentionDirectionFromGlobalPoint({ x: 200, y: 0 }, bounds)).toBe(0);
    expect(attentionDirectionFromGlobalPoint({ x: 500, y: 300 }, bounds)).toBe(4);
    expect(attentionDirectionFromGlobalPoint({ x: 200, y: 600 }, bounds)).toBe(8);
    expect(attentionDirectionFromGlobalPoint({ x: 0, y: 300 }, bounds)).toBe(12);
  });

  it("quantizes around the face anchor instead of the mostly transparent window center", () => {
    const bounds = { x: 100, y: 200, width: 192, height: 208 };
    const options = {
      anchorRatio: { x: 52 / 192, y: 160 / 208 },
    };
    const face = {
      x: bounds.x + 52,
      y: bounds.y + 160,
    };
    expect(
      attentionDirectionFromGlobalPoint(
        { x: face.x, y: face.y - 100 },
        bounds,
        options,
      ),
    ).toBe(0);
    expect(
      attentionDirectionFromGlobalPoint(
        { x: face.x + 100, y: face.y },
        bounds,
        options,
      ),
    ).toBe(4);
    expect(
      attentionDirectionFromGlobalPoint(
        { x: face.x, y: face.y + 100 },
        bounds,
        options,
      ),
    ).toBe(8);
    expect(
      attentionDirectionFromGlobalPoint(
        { x: face.x - 100, y: face.y },
        bounds,
        options,
      ),
    ).toBe(12);

    // This point is level with the face but not with the window center. The
    // old center-based calculation incorrectly classified it as down-right.
    expect(
      attentionDirectionFromGlobalPoint(
        { x: face.x + 200, y: face.y },
        bounds,
        options,
      ),
    ).toBe(4);
  });

  it("applies the dead zone around the face anchor", () => {
    const bounds = { x: 0, y: 0, width: 192, height: 208 };
    expect(
      attentionDirectionFromGlobalPoint(
        { x: 55, y: 160 },
        bounds,
        {
          anchorRatio: { x: 52 / 192, y: 160 / 208 },
          deadZonePx: 3,
        },
      ),
    ).toBeNull();
  });

  it("maps all 16 sectors around the face anchor in clockwise screen order", () => {
    const bounds = { x: -320, y: 140, width: 384, height: 416 };
    const anchorRatio = { x: 52 / 192, y: 160 / 208 };
    const anchor = {
      x: bounds.x + bounds.width * anchorRatio.x,
      y: bounds.y + bounds.height * anchorRatio.y,
    };
    for (const direction of DIRECTION_STEPS) {
      const radians = (direction.degrees * Math.PI) / 180;
      const point = {
        x: anchor.x + Math.sin(radians) * 200,
        y: anchor.y - Math.cos(radians) * 200,
      };
      expect(
        attentionDirectionFromGlobalPoint(point, bounds, { anchorRatio }),
        direction.name,
      ).toBe(direction.index);
    }
  });

  it("rejects non-positive attention bounds", () => {
    expect(() =>
      attentionDirectionFromGlobalPoint(
        { x: 0, y: 0 },
        { x: 0, y: 0, width: 0, height: 208 },
      ),
    ).toThrow(RangeError);
  });

  it("rejects an anchor outside the pet window", () => {
    expect(() =>
      attentionDirectionFromGlobalPoint(
        { x: 0, y: 0 },
        { x: 0, y: 0, width: 192, height: 208 },
        { anchorRatio: { x: -0.1, y: 0.5 } },
      ),
    ).toThrow(RangeError);
  });
});
