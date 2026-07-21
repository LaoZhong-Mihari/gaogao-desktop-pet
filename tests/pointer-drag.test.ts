import { describe, expect, it } from "vitest";

import {
  EMPTY_GLOBAL_POINTER_DRAG_STATE,
  resetGlobalPointerDrag,
  shouldTrackExternalDragAttention,
  updateGlobalPointerDrag,
} from "../src/core/pointer-drag";

describe("desktop-wide pointer drag recognition", () => {
  it("starts only after the pressed pointer crosses the movement threshold", () => {
    const pressed = updateGlobalPointerDrag(
      EMPTY_GLOBAL_POINTER_DRAG_STATE,
      { x: 100, y: 200, primaryButtonPressed: true },
      6,
    );
    expect(pressed.transition).toBe("none");
    expect(pressed.state.active).toBe(false);

    const jitter = updateGlobalPointerDrag(
      pressed.state,
      { x: 103, y: 204, primaryButtonPressed: true },
      6,
    );
    expect(jitter.transition).toBe("none");

    const dragged = updateGlobalPointerDrag(
      jitter.state,
      { x: 106, y: 200, primaryButtonPressed: true },
      6,
    );
    expect(dragged.transition).toBe("started");
    expect(dragged.state.active).toBe(true);
  });

  it("keeps tracking while pressed and ends immediately on release", () => {
    const active = {
      origin: { x: 10, y: 10 },
      active: true,
    } as const;
    expect(
      updateGlobalPointerDrag(
        active,
        { x: 80, y: 70, primaryButtonPressed: true },
        6,
      ).transition,
    ).toBe("none");

    const released = updateGlobalPointerDrag(
      active,
      { x: 80, y: 70, primaryButtonPressed: false },
      6,
    );
    expect(released.transition).toBe("ended");
    expect(released.state).toEqual(EMPTY_GLOBAL_POINTER_DRAG_STATE);
  });

  it("fails safe by clearing stale active state after a native polling error", () => {
    expect(
      resetGlobalPointerDrag({ origin: { x: 10, y: 20 }, active: true }),
    ).toEqual({
      state: EMPTY_GLOBAL_POINTER_DRAG_STATE,
      transition: "ended",
    });
  });

  it("clears an uncommitted press origin on release", () => {
    const pressed = updateGlobalPointerDrag(
      EMPTY_GLOBAL_POINTER_DRAG_STATE,
      { x: 100, y: 100, primaryButtonPressed: true },
      6,
    );
    const released = updateGlobalPointerDrag(
      pressed.state,
      { x: 104, y: 100, primaryButtonPressed: false },
      6,
    );
    expect(released).toEqual({
      state: EMPTY_GLOBAL_POINTER_DRAG_STATE,
      transition: "none",
    });

    const nextPress = updateGlobalPointerDrag(
      released.state,
      { x: 104, y: 100, primaryButtonPressed: true },
      6,
    );
    expect(nextPress.transition).toBe("none");
    expect(nextPress.state).toEqual({
      origin: { x: 104, y: 100 },
      active: false,
    });
  });

  it("does not mistake dragging Gaogao itself for an external item drag", () => {
    const blocked = updateGlobalPointerDrag(
      {
        origin: { x: 10, y: 10 },
        active: true,
      },
      { x: 40, y: 40, primaryButtonPressed: true },
      6,
      true,
    );
    expect(blocked.transition).toBe("ended");
    expect(blocked.state.active).toBe(false);
  });

  it("discards movement accumulated while Gaogao pointer setup is pending", () => {
    const pendingStart = updateGlobalPointerDrag(
      EMPTY_GLOBAL_POINTER_DRAG_STATE,
      { x: 20, y: 30, primaryButtonPressed: true },
      6,
      true,
    );
    const pendingMove = updateGlobalPointerDrag(
      pendingStart.state,
      { x: 80, y: 90, primaryButtonPressed: true },
      6,
      true,
    );
    expect(pendingMove.transition).toBe("none");
    expect(pendingMove.state).toEqual({
      origin: { x: 80, y: 90 },
      active: false,
    });

    const setupFinished = updateGlobalPointerDrag(
      pendingMove.state,
      { x: 80, y: 90, primaryButtonPressed: true },
      6,
      false,
    );
    expect(setupFinished.transition).toBe("none");
    expect(setupFinished.state.active).toBe(false);

    const subsequentExternalMove = updateGlobalPointerDrag(
      setupFinished.state,
      { x: 86, y: 90, primaryButtonPressed: true },
      6,
      false,
    );
    expect(subsequentExternalMove.transition).toBe("started");
    expect(subsequentExternalMove.state.active).toBe(true);
  });

  it("rejects an invalid threshold", () => {
    expect(() =>
      updateGlobalPointerDrag(
        EMPTY_GLOBAL_POINTER_DRAG_STATE,
        { x: 0, y: 0, primaryButtonPressed: false },
        -1,
      ),
    ).toThrow(RangeError);
  });

  it("keeps attention active when a file leaves the window but the global drag continues", () => {
    expect(
      shouldTrackExternalDragAttention({
        globalPointerDragActive: true,
        windowDropHoverActive: false,
        paused: false,
        attentionEnabled: true,
      }),
    ).toBe(true);
    expect(
      shouldTrackExternalDragAttention({
        globalPointerDragActive: false,
        windowDropHoverActive: true,
        paused: false,
        attentionEnabled: true,
      }),
    ).toBe(true);
    expect(
      shouldTrackExternalDragAttention({
        globalPointerDragActive: false,
        windowDropHoverActive: false,
        paused: false,
        attentionEnabled: true,
      }),
    ).toBe(false);
  });

  it("honors pause and the attention setting for both drag sources", () => {
    expect(
      shouldTrackExternalDragAttention({
        globalPointerDragActive: true,
        windowDropHoverActive: true,
        paused: true,
        attentionEnabled: true,
      }),
    ).toBe(false);
    expect(
      shouldTrackExternalDragAttention({
        globalPointerDragActive: true,
        windowDropHoverActive: true,
        paused: false,
        attentionEnabled: false,
      }),
    ).toBe(false);
  });
});
