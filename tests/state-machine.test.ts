import { describe, expect, it, vi } from "vitest";

import {
  PetStateMachine,
  type TimerScheduler,
} from "../src/core/state-machine";

class ControllableScheduler implements TimerScheduler {
  private nextId = 1;
  readonly callbacks = new Map<number, () => void>();
  readonly cleared = new Set<number>();

  setTimeout(callback: () => void): number {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.cleared.add(handle as number);
  }

  fire(id: number): void {
    this.callbacks.get(id)?.();
  }
}

describe("PetStateMachine", () => {
  it("enforces direct > roam > attention > idle priority", () => {
    const machine = new PetStateMachine();
    expect(machine.current).toEqual({
      source: "idle",
      pose: { kind: "animation", animation: "idle" },
    });

    machine.setIntent("attention", { kind: "look", direction: 4 });
    expect(machine.current.source).toBe("attention");
    machine.setIntent("roam", { kind: "animation", animation: "running-right" });
    expect(machine.current.source).toBe("roam");
    machine.setIntent("direct", { kind: "animation", animation: "waving" });
    expect(machine.current.source).toBe("direct");

    machine.clearIntent("direct");
    expect(machine.current.source).toBe("roam");
    machine.clearIntent("roam");
    expect(machine.current.source).toBe("attention");
    machine.clearIntent("attention");
    expect(machine.current.source).toBe("idle");
  });

  it("expires a temporary intent back to the next active layer", () => {
    const scheduler = new ControllableScheduler();
    const listener = vi.fn();
    const machine = new PetStateMachine({ scheduler, onChange: listener });
    machine.setIntent("attention", { kind: "look", direction: 12 });
    machine.setIntent("direct", { kind: "animation", animation: "waving" }, 700);
    expect(machine.current.source).toBe("direct");

    scheduler.fire(1);
    expect(machine.current).toEqual({
      source: "attention",
      pose: { kind: "look", direction: 12 },
    });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("ignores a stale timeout after the same layer is replaced", () => {
    const scheduler = new ControllableScheduler();
    const machine = new PetStateMachine({ scheduler });
    machine.setIntent("direct", { kind: "animation", animation: "waving" }, 500);
    machine.setIntent("direct", { kind: "animation", animation: "jumping" }, 900);
    expect(scheduler.cleared).toContain(1);

    // Simulate an event loop delivering a callback that was already cancelled.
    scheduler.fire(1);
    expect(machine.current).toEqual({
      source: "direct",
      pose: { kind: "animation", animation: "jumping" },
    });
    scheduler.fire(2);
    expect(machine.current.source).toBe("idle");
  });

  it("can replace idle behavior while a higher layer remains active", () => {
    const machine = new PetStateMachine();
    machine.setIntent("roam", { kind: "animation", animation: "running-left" });
    machine.setIdlePose({ kind: "animation", animation: "grooming" });
    expect(machine.current.source).toBe("roam");
    machine.clearIntent("roam");
    expect(machine.current.pose).toEqual({ kind: "animation", animation: "grooming" });
  });

  it("clears every transient timer and rejects use after disposal", () => {
    const scheduler = new ControllableScheduler();
    const machine = new PetStateMachine({ scheduler });
    machine.setIntent("attention", { kind: "look", direction: 0 }, 100);
    machine.setIntent("roam", { kind: "animation", animation: "running-right" }, 200);
    machine.resetTransientIntents();
    expect(machine.current.source).toBe("idle");
    expect(scheduler.cleared).toEqual(new Set([1, 2]));

    machine.dispose();
    expect(() => machine.setIdlePose({ kind: "animation", animation: "idle" })).toThrow(
      "disposed",
    );
  });

  it("rejects invalid temporary durations", () => {
    const machine = new PetStateMachine();
    expect(() =>
      machine.setIntent("direct", { kind: "animation", animation: "waving" }, 0),
    ).toThrow(RangeError);
  });

  it("notifies when an attention image changes to a different direction", () => {
    const listener = vi.fn();
    const machine = new PetStateMachine({ onChange: listener });
    machine.setIntent("attention", { kind: "look", direction: 4 });
    machine.setIntent("attention", { kind: "look", direction: 5 });
    expect(machine.current.pose).toEqual({ kind: "look", direction: 5 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps a drag attention pose active through direction updates until cleared", () => {
    const machine = new PetStateMachine();
    machine.setIntent("attention", { kind: "look", direction: 2 });
    machine.setIntent("attention", { kind: "look", direction: 10 });
    expect(machine.current).toEqual({
      source: "attention",
      pose: { kind: "look", direction: 10 },
    });
    machine.clearIntent("attention");
    expect(machine.current.source).toBe("idle");
  });
});
