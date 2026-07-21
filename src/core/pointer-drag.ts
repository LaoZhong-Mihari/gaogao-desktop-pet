export interface GlobalPointerSample {
  readonly x: number;
  readonly y: number;
  readonly primaryButtonPressed: boolean;
}

export interface GlobalPointerDragState {
  readonly origin: { readonly x: number; readonly y: number } | null;
  readonly active: boolean;
}

export type GlobalPointerDragTransition = "none" | "started" | "ended";

export interface GlobalPointerDragUpdate {
  readonly state: GlobalPointerDragState;
  readonly transition: GlobalPointerDragTransition;
}

export const EMPTY_GLOBAL_POINTER_DRAG_STATE: GlobalPointerDragState = Object.freeze({
  origin: null,
  active: false,
});

export function resetGlobalPointerDrag(
  previous: GlobalPointerDragState,
): GlobalPointerDragUpdate {
  return {
    state: EMPTY_GLOBAL_POINTER_DRAG_STATE,
    transition: previous.active ? "ended" : "none",
  };
}

export function shouldTrackExternalDragAttention(options: {
  readonly globalPointerDragActive: boolean;
  readonly windowDropHoverActive: boolean;
  readonly paused: boolean;
  readonly attentionEnabled: boolean;
}): boolean {
  return (
    !options.paused &&
    options.attentionEnabled &&
    (options.globalPointerDragActive || options.windowDropHoverActive)
  );
}

/**
 * Recognizes a desktop-wide primary-button drag from native pointer samples.
 * This deliberately does not claim that the payload is a file: the OS only
 * exposes the concrete file paths after they enter our drop target. The early
 * drag signal lets Gaogao notice an item before it reaches the pet window.
 */
export function updateGlobalPointerDrag(
  previous: GlobalPointerDragState,
  sample: GlobalPointerSample,
  thresholdPx: number,
  blocked = false,
): GlobalPointerDragUpdate {
  if (!Number.isFinite(thresholdPx) || thresholdPx < 0) {
    throw new RangeError("thresholdPx must be a finite non-negative number");
  }
  if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
    return {
      state: previous,
      transition: "none",
    };
  }

  if (!sample.primaryButtonPressed) {
    return resetGlobalPointerDrag(previous);
  }

  if (blocked) {
    return {
      state: {
        origin: { x: sample.x, y: sample.y },
        active: false,
      },
      transition: previous.active ? "ended" : "none",
    };
  }

  const origin = previous.origin ?? { x: sample.x, y: sample.y };
  const active =
    previous.active ||
    Math.hypot(sample.x - origin.x, sample.y - origin.y) >= thresholdPx;
  return {
    state: { origin, active },
    transition: !previous.active && active ? "started" : "none",
  };
}
