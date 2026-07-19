import type { DirectionIndex } from "./direction";
import type { BaseAnimationId } from "./manifest";

export type PetIntentSource = "idle" | "attention" | "roam" | "direct";
export type TransientIntentSource = Exclude<PetIntentSource, "idle">;

export type PetPose =
  | {
      readonly kind: "animation";
      readonly animation: BaseAnimationId;
    }
  | {
      readonly kind: "look";
      readonly direction: DirectionIndex;
    };

export interface ActivePetState {
  readonly source: PetIntentSource;
  readonly pose: PetPose;
}

export const PET_STATE_PRIORITY: Readonly<Record<PetIntentSource, number>> = Object.freeze({
  idle: 100,
  attention: 200,
  roam: 300,
  direct: 400,
});

export interface TimerScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type PetStateListener = (
  current: ActivePetState,
  previous: ActivePetState,
) => void;

interface IntentEntry {
  readonly state: ActivePetState;
  readonly revision: number;
  timer: unknown | null;
}

const DEFAULT_SCHEDULER: TimerScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
};

const DEFAULT_IDLE_POSE: PetPose = { kind: "animation", animation: "idle" };

function samePose(left: PetPose, right: PetPose): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "look"
    ? left.direction === (right as Extract<PetPose, { kind: "look" }>).direction
    : left.animation === (right as Extract<PetPose, { kind: "animation" }>).animation;
}

function sameState(left: ActivePetState, right: ActivePetState): boolean {
  return left.source === right.source && samePose(left.pose, right.pose);
}

/**
 * Maintains one intent per priority tier. A higher tier temporarily masks lower
 * tiers; clearing or expiring it automatically reveals the next active tier.
 */
export class PetStateMachine {
  private readonly scheduler: TimerScheduler;
  private readonly listener: PetStateListener | undefined;
  private readonly intents = new Map<PetIntentSource, IntentEntry>();
  private revision = 0;
  private active: ActivePetState;
  private disposed = false;

  constructor(options: {
    readonly idlePose?: PetPose;
    readonly scheduler?: TimerScheduler;
    readonly onChange?: PetStateListener;
  } = {}) {
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    this.listener = options.onChange;
    this.active = { source: "idle", pose: options.idlePose ?? DEFAULT_IDLE_POSE };
    this.intents.set("idle", {
      state: this.active,
      revision: this.nextRevision(),
      timer: null,
    });
  }

  get current(): ActivePetState {
    return this.active;
  }

  setIdlePose(pose: PetPose): void {
    this.assertUsable();
    this.replaceIntent("idle", pose);
  }

  setIntent(source: TransientIntentSource, pose: PetPose, durationMs?: number): void {
    this.assertUsable();
    if (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs <= 0)) {
      throw new RangeError("durationMs must be a finite positive number");
    }
    this.replaceIntent(source, pose, durationMs);
  }

  clearIntent(source: TransientIntentSource): void {
    this.assertUsable();
    const entry = this.intents.get(source);
    if (entry === undefined) {
      return;
    }
    this.clearEntryTimer(entry);
    this.intents.delete(source);
    this.recomputeActive();
  }

  hasIntent(source: PetIntentSource): boolean {
    return this.intents.has(source);
  }

  resetTransientIntents(): void {
    this.assertUsable();
    for (const source of ["direct", "roam", "attention"] as const) {
      const entry = this.intents.get(source);
      if (entry !== undefined) {
        this.clearEntryTimer(entry);
        this.intents.delete(source);
      }
    }
    this.recomputeActive();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    for (const entry of this.intents.values()) {
      this.clearEntryTimer(entry);
    }
    this.intents.clear();
    this.disposed = true;
  }

  private replaceIntent(source: PetIntentSource, pose: PetPose, durationMs?: number): void {
    const previous = this.intents.get(source);
    if (previous !== undefined) {
      this.clearEntryTimer(previous);
    }

    const revision = this.nextRevision();
    const entry: IntentEntry = {
      state: { source, pose },
      revision,
      timer: null,
    };
    this.intents.set(source, entry);

    if (durationMs !== undefined) {
      entry.timer = this.scheduler.setTimeout(() => {
        if (this.disposed) {
          return;
        }
        const latest = this.intents.get(source);
        if (latest?.revision !== revision) {
          return;
        }
        latest.timer = null;
        this.intents.delete(source);
        this.recomputeActive();
      }, durationMs);
    }
    this.recomputeActive();
  }

  private recomputeActive(): void {
    let selected: ActivePetState | undefined;
    for (const entry of this.intents.values()) {
      if (
        selected === undefined ||
        PET_STATE_PRIORITY[entry.state.source] > PET_STATE_PRIORITY[selected.source]
      ) {
        selected = entry.state;
      }
    }
    if (selected === undefined) {
      throw new Error("PetStateMachine lost its idle intent");
    }

    const previous = this.active;
    this.active = selected;
    if (!sameState(previous, selected)) {
      this.listener?.(selected, previous);
    }
  }

  private clearEntryTimer(entry: IntentEntry): void {
    if (entry.timer !== null) {
      this.scheduler.clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  private nextRevision(): number {
    this.revision += 1;
    return this.revision;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("PetStateMachine has been disposed");
    }
  }
}
