import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  PetStateMachine,
  ACTIVE_ATTENTION_POLL_MS,
  EMPTY_GLOBAL_POINTER_DRAG_STATE,
  OCCASIONAL_ATTENTION_DURATION_MS,
  actionHoldDurationMs,
  attentionDirectionFromGlobalPoint,
  animationFrameRect,
  createRoamPlan,
  extractAlphaMask,
  groundedWindowPosition,
  hitTestAlphaMask,
  loadPetManifest,
  lookDirectionFrameRect,
  nextOccasionalAttentionDelayMs,
  pickAmbientAnimation,
  resetGlobalPointerDrag,
  stepHorizontalRoam,
  shouldTrackExternalDragAttention,
  updateGlobalPointerDrag,
  updateSettings,
  type ActivePetState,
  type AlphaMask,
  type BaseAnimationId,
  type HorizontalDirection,
  type GlobalPointerDragState,
  type PetManifest,
  type PetSettings,
  type PixelRect,
} from "../core";
import {
  bottomCenterAnchoredPosition,
  effectivePetScale,
  hasFeedingGrowth,
  nextGrowthBonus,
  resetFeedingGrowth,
  singleDroppedPath,
} from "../core/feeding";
import { loadSettings, saveSettings } from "../app/store";
import {
  beginPetDrag,
  endPetDrag,
  getGlobalPointerState,
  getWindowGeometry,
  moveWindow,
  resizeWindow,
  runtimeAvailable,
  setAlwaysOnTop,
  setIgnoreCursorEvents,
  setLaunchAtLogin,
  setPetVisible,
  setGrowthResetEnabled,
  showPetMenu,
  showSettings,
  updatePetDrag,
  validateFoodToken,
  type GlobalPointerState,
  type WindowGeometry,
} from "../app/native";

const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 208;
const DRAG_THRESHOLD_PX = 5;
const DOUBLE_CLICK_MS = 260;
const HIT_TEST_MS = 45;
const GLOBAL_POINTER_DRAG_POLL_MS = 50;
const GLOBAL_POINTER_DRAG_THRESHOLD_PX = 6;
const ROAM_IDLE_MS = 45_000;
const ROAM_TICK_MS = 50;
const ROAM_SPEED_LOGICAL_PX_PER_SECOND = 28;
const WINDOW_MARGIN_LOGICAL_PX = 12;

interface DragState {
  pointerId: number;
  moved: boolean;
}

interface RoamState {
  direction: HorizontalDirection;
  stopAt: number;
  lastTick: number;
  timer: number;
}

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

function workArea(geometry: WindowGeometry): NonNullable<WindowGeometry["workArea"]> {
  return (
    geometry.workArea ?? {
      x: 0,
      y: 0,
      width: Math.max(geometry.width, window.screen.availWidth * geometry.scaleFactor),
      height: Math.max(geometry.height, window.screen.availHeight * geometry.scaleFactor),
    }
  );
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

class PetController {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly manifest: PetManifest;
  private readonly atlas: HTMLImageElement;
  private readonly atlasPixels: ImageData;
  private readonly stateMachine: PetStateMachine;
  private settings: PetSettings;
  private currentFrameRect: PixelRect;
  private currentMask: AlphaMask;
  private animationTimer: number | null = null;
  private animationRevision = 0;
  private ambientTimer: number | null = null;
  private occasionalAttentionTimer: number | null = null;
  private occasionalAttentionTrackingTimer: number | null = null;
  private occasionalAttentionRevision = 0;
  private occasionalAttentionEndsAt = 0;
  private clickTimer: number | null = null;
  private drag: DragState | null = null;
  private petPointerInteractionPending = false;
  private pendingPointerId: number | null = null;
  private roam: RoamState | null = null;
  private paused = false;
  private fileDragActive = false;
  private windowDropHoverActive = false;
  private globalPointerDragActive = false;
  private globalPointerDragState: GlobalPointerDragState =
    EMPTY_GLOBAL_POINTER_DRAG_STATE;
  private globalPointerPollBusy = false;
  private foodDropPending = false;
  private fileAttentionRevision = 0;
  private fileAttentionTimer: number | null = null;
  private lastInteraction = Date.now();
  private lastIgnoreCursor: boolean | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    manifest: PetManifest,
    atlas: HTMLImageElement,
    atlasPixels: ImageData,
    settings: PetSettings,
  ) {
    this.canvas = canvas;
    this.context = context;
    this.manifest = manifest;
    this.atlas = atlas;
    this.atlasPixels = atlasPixels;
    this.settings = settings;
    this.currentFrameRect = animationFrameRect(manifest, "idle", 0);
    this.currentMask = extractAlphaMask(atlasPixels, this.currentFrameRect);
    this.stateMachine = new PetStateMachine({
      onChange: (current) => this.renderState(current),
    });
  }

  async start(): Promise<void> {
    this.wirePointerEvents();
    await this.wireApplicationEvents();
    await this.wireFileDragEvents();
    this.startGlobalPointerDragWatcher();
    await this.applySettings(this.settings, true);
    await this.restorePosition();
    this.renderState(this.stateMachine.current);
    this.startHitTesting();
    this.startRoamWatcher();
    this.scheduleAmbient();
    this.scheduleOccasionalAttention();
    await setPetVisible(true);
  }

  private drawFrame(rect: PixelRect): void {
    this.context.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    this.context.imageSmoothingEnabled = false;
    this.context.drawImage(
      this.atlas,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      FRAME_WIDTH,
      FRAME_HEIGHT,
    );
    this.currentFrameRect = rect;
    this.currentMask = extractAlphaMask(this.atlasPixels, rect);
  }

  private renderState(state: ActivePetState): void {
    this.animationRevision += 1;
    if (this.animationTimer !== null) window.clearTimeout(this.animationTimer);
    this.animationTimer = null;
    if (state.pose.kind === "look") {
      this.drawFrame(lookDirectionFrameRect(this.manifest, state.pose.direction));
      return;
    }
    this.playAnimation(state.pose.animation, this.animationRevision);
  }

  private playAnimation(animationId: BaseAnimationId, revision: number): void {
    const definition = this.manifest.animations[animationId];
    let index = 0;
    const drawNext = (): void => {
      if (revision !== this.animationRevision) return;
      const frame = definition.frames[index];
      this.drawFrame(animationFrameRect(this.manifest, animationId, index));
      const atEnd = index === definition.frames.length - 1;
      if (atEnd && !definition.loop) return;
      index = atEnd ? 0 : index + 1;
      this.animationTimer = window.setTimeout(drawNext, frame.durationMs);
    };
    drawNext();
  }

  private playDirect(animation: BaseAnimationId): void {
    if (this.paused) return;
    this.noteInteraction();
    this.stopRoaming();
    this.stateMachine.clearIntent("attention");
    this.stateMachine.setIntent(
      "direct",
      { kind: "animation", animation },
      actionHoldDurationMs(this.manifest, animation),
    );
  }

  private noteInteraction(): void {
    this.stopOccasionalAttentionTracking();
    this.lastInteraction = Date.now();
  }

  private wirePointerEvents(): void {
    this.canvas.addEventListener("pointerdown", (event) => void this.pointerDown(event));
    this.canvas.addEventListener("pointermove", () => void this.pointerMove());
    this.canvas.addEventListener("pointerup", (event) => void this.pointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => void this.pointerUp(event));
    this.canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.noteInteraction();
      void showPetMenu();
    });
    window.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        void showSettings();
      }
    });
  }

  private async pointerDown(event: PointerEvent): Promise<void> {
    if (event.button !== 0 || this.paused) return;
    this.petPointerInteractionPending = true;
    this.pendingPointerId = event.pointerId;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.noteInteraction();
    this.stopRoaming();
    this.stateMachine.clearIntent("attention");
    try {
      await this.setCursorPassthrough(false);
      await beginPetDrag(event.pointerId);
      if (this.pendingPointerId !== event.pointerId) {
        await endPetDrag(event.pointerId).catch(() => undefined);
        return;
      }
      this.drag = {
        pointerId: event.pointerId,
        moved: false,
      };
    } catch {
      await endPetDrag(event.pointerId).catch(() => undefined);
      if (this.canvas.hasPointerCapture(event.pointerId)) {
        this.canvas.releasePointerCapture(event.pointerId);
      }
    } finally {
      if (this.pendingPointerId === event.pointerId) {
        this.pendingPointerId = null;
        this.petPointerInteractionPending = false;
      }
    }
  }

  private async pointerMove(): Promise<void> {
    const drag = this.drag;
    if (drag === null) return;
    const update = await updatePetDrag(drag.pointerId, DRAG_THRESHOLD_PX).catch(
      () => null,
    );
    if (update === null || this.drag !== drag) return;
    if (!drag.moved && update.moved) {
      drag.moved = true;
      this.canvas.classList.add("is-dragging");
    }
    if (!drag.moved) return;
    this.stateMachine.setIntent("direct", {
      kind: "animation",
      animation: update.movementX < 0 ? "running-left" : "running-right",
    });
  }

  private async pointerUp(event: PointerEvent): Promise<void> {
    const drag = this.drag;
    if (drag === null) {
      if (this.pendingPointerId === event.pointerId) {
        this.pendingPointerId = null;
        this.petPointerInteractionPending = false;
        if (this.canvas.hasPointerCapture(event.pointerId)) {
          this.canvas.releasePointerCapture(event.pointerId);
        }
        await endPetDrag(event.pointerId).catch(() => undefined);
        this.queueClick();
      }
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.canvas.classList.remove("is-dragging");
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.stateMachine.clearIntent("direct");
    const ended = await endPetDrag(event.pointerId).catch(async () => ({
      moved: drag.moved,
      geometry: await getWindowGeometry("pet"),
    }));
    if (drag.moved || ended.moved) {
      const { geometry } = ended;
      this.settings = updateSettings(this.settings, {
        windowPosition: {
          x: geometry.x,
          y: geometry.y,
          monitorId: geometry.monitorName ?? undefined,
        },
      });
      await saveSettings(this.settings);
    } else {
      this.queueClick();
    }
  }

  private queueClick(): void {
    if (this.clickTimer !== null) {
      window.clearTimeout(this.clickTimer);
      this.clickTimer = null;
      this.playDirect("jumping");
      return;
    }
    this.clickTimer = window.setTimeout(() => {
      this.clickTimer = null;
      this.playDirect("waving");
    }, DOUBLE_CLICK_MS);
  }

  private async wireApplicationEvents(): Promise<void> {
    if (!runtimeAvailable()) return;
    await listen<PetSettings>("settings://changed", ({ payload }) => {
      void this.applySettings(updateSettings(this.settings, { ...payload }), false, false);
    });
    await listen("command://reset-position", () => void this.resetPosition());
    await listen("tray://reset-growth", () => void this.resetFeedingGrowth());
    await listen<boolean>("tray://pause-changed", ({ payload }) => this.setPaused(payload));
    await listen("tray://grooming", () => this.playDirect("grooming"));
    await listen<boolean>("tray://always-on-top-changed", ({ payload }) => {
      if (payload !== this.settings.alwaysOnTop) {
        void this.applySettings(
          updateSettings(this.settings, { alwaysOnTop: payload }),
          false,
          false,
        );
      }
    });
    await listen<boolean>("tray://launch-at-login-changed", ({ payload }) => {
      if (payload !== this.settings.launchAtLogin) {
        void this.applySettings(
          updateSettings(this.settings, { launchAtLogin: payload }),
          false,
          false,
        );
      }
    });
  }

  private async applySettings(
    next: PetSettings,
    initial = false,
    syncNative = true,
  ): Promise<void> {
    const previousScale = effectivePetScale(
      this.settings.scale,
      this.settings.growthBonus,
    );
    const nextScale = effectivePetScale(next.scale, next.growthBonus);
    this.settings = next;
    const writes: Promise<unknown>[] = [saveSettings(next)];
    writes.push(setGrowthResetEnabled(hasFeedingGrowth(next.growthBonus)));
    if (syncNative) {
      writes.push(
        setAlwaysOnTop(next.alwaysOnTop),
        setLaunchAtLogin(next.launchAtLogin),
      );
    }
    await Promise.all(writes);
    if (initial || previousScale !== nextScale) {
      const geometry = await getWindowGeometry("pet");
      const nextSize = {
        width: FRAME_WIDTH * nextScale * geometry.scaleFactor,
        height: FRAME_HEIGHT * nextScale * geometry.scaleFactor,
      };
      const anchored = bottomCenterAnchoredPosition(geometry, nextSize);
      await resizeWindow(
        "pet",
        nextSize.width,
        nextSize.height,
      );
      if (!initial) {
        await moveWindow("pet", anchored.x, anchored.y);
      }
      await this.ensureVisibleAtBottom(false);
      if (!initial) {
        const placed = await getWindowGeometry("pet");
        this.settings = updateSettings(this.settings, {
          windowPosition: {
            x: placed.x,
            y: placed.y,
            monitorId: placed.monitorName ?? undefined,
          },
        });
        await saveSettings(this.settings);
      }
    }
    if (!next.attentionEnabled) {
      this.stopOccasionalAttentionTracking();
    }
    this.syncExternalDragAttention();
    if (!next.autoRoam) this.stopRoaming();
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.canvas.classList.toggle("is-paused", paused);
    if (paused) {
      this.stopOccasionalAttentionTracking();
      this.stopRoaming();
      this.stateMachine.resetTransientIntents();
      this.stateMachine.setIdlePose({ kind: "animation", animation: "idle" });
      this.animationRevision += 1;
      if (this.animationTimer !== null) window.clearTimeout(this.animationTimer);
    } else {
      this.renderState(this.stateMachine.current);
      this.noteInteraction();
    }
    this.syncExternalDragAttention();
  }

  private scheduleOccasionalAttention(): void {
    if (this.occasionalAttentionTimer !== null) {
      window.clearTimeout(this.occasionalAttentionTimer);
    }
    this.occasionalAttentionTimer = window.setTimeout(() => {
      this.occasionalAttentionTimer = null;
      void this.runOccasionalAttention();
      this.scheduleOccasionalAttention();
    }, nextOccasionalAttentionDelayMs());
  }

  private canRunOccasionalAttention(): boolean {
    return (
      !this.paused &&
      this.settings.attentionEnabled &&
      this.roam === null &&
      this.drag === null &&
      !this.fileDragActive &&
      this.stateMachine.current.source === "idle"
    );
  }

  private async runOccasionalAttention(): Promise<void> {
    if (!this.canRunOccasionalAttention()) return;
    this.stopOccasionalAttentionTracking();
    const revision = this.occasionalAttentionRevision;
    this.occasionalAttentionEndsAt = Date.now() + OCCASIONAL_ATTENTION_DURATION_MS;
    await this.updateOccasionalAttention(revision);
  }

  private canMaintainOccasionalAttention(): boolean {
    return (
      !this.paused &&
      this.settings.attentionEnabled &&
      this.roam === null &&
      this.drag === null &&
      !this.fileDragActive &&
      (this.stateMachine.current.source === "idle" ||
        this.stateMachine.current.source === "attention")
    );
  }

  private stopOccasionalAttentionTracking(): void {
    this.occasionalAttentionRevision += 1;
    this.occasionalAttentionEndsAt = 0;
    if (this.occasionalAttentionTrackingTimer !== null) {
      window.clearTimeout(this.occasionalAttentionTrackingTimer);
      this.occasionalAttentionTrackingTimer = null;
    }
    if (!this.fileDragActive) this.stateMachine.clearIntent("attention");
  }

  private scheduleOccasionalAttentionUpdate(revision: number): void {
    const remaining = this.occasionalAttentionEndsAt - Date.now();
    if (revision !== this.occasionalAttentionRevision) return;
    if (remaining <= 0 || !this.canMaintainOccasionalAttention()) {
      this.stopOccasionalAttentionTracking();
      return;
    }
    this.occasionalAttentionTrackingTimer = window.setTimeout(() => {
      this.occasionalAttentionTrackingTimer = null;
      void this.updateOccasionalAttention(revision);
    }, Math.min(ACTIVE_ATTENTION_POLL_MS, remaining));
  }

  private async updateOccasionalAttention(revision: number): Promise<void> {
    if (revision !== this.occasionalAttentionRevision) return;
    if (
      Date.now() >= this.occasionalAttentionEndsAt ||
      !this.canMaintainOccasionalAttention()
    ) {
      this.stopOccasionalAttentionTracking();
      return;
    }
    const snapshot = await this.readPointerGeometry();
    if (snapshot === null) {
      this.scheduleOccasionalAttentionUpdate(revision);
      return;
    }
    const { cursor, geometry } = snapshot;
    if (revision !== this.occasionalAttentionRevision) return;
    if (
      Date.now() >= this.occasionalAttentionEndsAt ||
      !this.canMaintainOccasionalAttention()
    ) {
      this.stopOccasionalAttentionTracking();
      return;
    }
    const direction = attentionDirectionFromGlobalPoint(
      cursor,
      geometry,
      {
        anchorRatio: this.attentionAnchorRatio(),
        deadZonePx: 24 * geometry.scaleFactor,
      },
    );
    if (direction === null) {
      this.stateMachine.clearIntent("attention");
    } else {
      this.stateMachine.setIntent("attention", { kind: "look", direction });
    }
    this.scheduleOccasionalAttentionUpdate(revision);
  }

  private async wireFileDragEvents(): Promise<void> {
    if (!runtimeAvailable()) return;
    await getCurrentWindow().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter") {
        this.windowDropHoverActive = true;
        this.syncExternalDragAttention();
        return;
      }
      if (payload.type === "over") {
        // Some platforms can deliver an over event without a preceding enter.
        this.windowDropHoverActive = true;
        this.syncExternalDragAttention();
        return;
      }
      if (payload.type === "drop") {
        this.windowDropHoverActive = false;
        this.syncExternalDragAttention();
        void this.handleFileDrop(payload.paths);
        return;
      }
      this.windowDropHoverActive = false;
      this.syncExternalDragAttention();
    });
  }

  private attentionAnchorRatio(): { x: number; y: number } {
    return {
      x: this.manifest.attentionAnchor.x / this.manifest.spritesheet.frameWidth,
      y: this.manifest.attentionAnchor.y / this.manifest.spritesheet.frameHeight,
    };
  }

  /**
   * Tauri's drop event begins only after a file enters this window. Polling the
   * native primary button lets Gaogao notice the desktop drag beforehand.
   */
  private startGlobalPointerDragWatcher(): void {
    if (!runtimeAvailable()) return;
    window.setInterval(() => {
      void this.pollGlobalPointerDrag();
    }, GLOBAL_POINTER_DRAG_POLL_MS);
  }

  private async pollGlobalPointerDrag(): Promise<void> {
    if (this.globalPointerPollBusy) return;
    this.globalPointerPollBusy = true;
    try {
      const sample = await getGlobalPointerState();
      const update = updateGlobalPointerDrag(
        this.globalPointerDragState,
        sample,
        GLOBAL_POINTER_DRAG_THRESHOLD_PX,
        this.petPointerInteractionPending || this.drag !== null,
      );
      this.globalPointerDragState = update.state;
      if (update.transition === "started") {
        this.globalPointerDragActive = true;
        this.syncExternalDragAttention();
      } else if (update.transition === "ended") {
        this.globalPointerDragActive = false;
        this.syncExternalDragAttention();
      }
    } catch {
      this.globalPointerDragState = resetGlobalPointerDrag(
        this.globalPointerDragState,
      ).state;
      if (this.globalPointerDragActive) {
        this.globalPointerDragActive = false;
        this.syncExternalDragAttention();
      }
    } finally {
      this.globalPointerPollBusy = false;
    }
  }

  private syncExternalDragAttention(): void {
    const active = shouldTrackExternalDragAttention({
      globalPointerDragActive: this.globalPointerDragActive,
      windowDropHoverActive: this.windowDropHoverActive,
      paused: this.paused,
      attentionEnabled: this.settings.attentionEnabled,
    });
    if (active === this.fileDragActive) return;
    if (active) {
      this.startFileAttention();
    } else {
      this.stopFileAttention();
    }
  }

  /** Starts continuous file-drag tracking independently of the random look window. */
  private startFileAttention(): void {
    this.stopOccasionalAttentionTracking();
    this.fileDragActive = true;
    this.fileAttentionRevision += 1;
    this.stopRoaming();
    void this.setCursorPassthrough(false).catch(() => undefined);
    void this.updateFileAttention(this.fileAttentionRevision);
  }

  /** Invalidates in-flight reads and immediately restores normal state selection. */
  private stopFileAttention(): void {
    this.fileDragActive = false;
    this.stopFileAttentionPolling();
    this.stateMachine.clearIntent("attention");
  }

  private stopFileAttentionPolling(): void {
    this.fileAttentionRevision += 1;
    if (this.fileAttentionTimer !== null) {
      window.clearTimeout(this.fileAttentionTimer);
      this.fileAttentionTimer = null;
    }
  }

  private scheduleFileAttentionUpdate(revision: number): void {
    if (
      revision !== this.fileAttentionRevision ||
      !this.fileDragActive ||
      this.paused ||
      !this.settings.attentionEnabled
    ) {
      return;
    }
    this.fileAttentionTimer = window.setTimeout(() => {
      this.fileAttentionTimer = null;
      void this.updateFileAttention(revision);
    }, ACTIVE_ATTENTION_POLL_MS);
  }

  private async updateFileAttention(revision: number): Promise<void> {
    if (this.paused || !this.settings.attentionEnabled) return;
    const snapshot = await this.readPointerGeometry();
    if (snapshot === null) {
      this.scheduleFileAttentionUpdate(revision);
      return;
    }
    const { cursor, geometry } = snapshot;
    if (
      revision !== this.fileAttentionRevision ||
      !this.fileDragActive ||
      this.paused ||
      !this.settings.attentionEnabled
    ) {
      return;
    }
    const direction = attentionDirectionFromGlobalPoint(
      cursor,
      geometry,
      {
        anchorRatio: this.attentionAnchorRatio(),
        deadZonePx: 8 * geometry.scaleFactor,
      },
    );
    if (direction === null) {
      this.stateMachine.clearIntent("attention");
    } else {
      this.stateMachine.setIntent("attention", { kind: "look", direction });
    }
    this.scheduleFileAttentionUpdate(revision);
  }

  private async handleFileDrop(paths: readonly string[]): Promise<void> {
    const path = singleDroppedPath(paths);
    if (this.paused || this.foodDropPending || path === null) return;
    this.foodDropPending = true;
    try {
      if (!(await validateFoodToken(path))) return;
      this.noteInteraction();
      this.stopRoaming();
      const next = updateSettings(this.settings, {
        growthBonus: nextGrowthBonus(this.settings.growthBonus),
      });
      await this.applySettings(next, false, false);
      if (runtimeAvailable()) {
        await emitTo("settings", "pet://settings-changed", this.settings);
      }
    } finally {
      this.foodDropPending = false;
    }
  }

  private async resetFeedingGrowth(): Promise<void> {
    if (!hasFeedingGrowth(this.settings.growthBonus)) return;
    const next = updateSettings(this.settings, {
      growthBonus: resetFeedingGrowth(this.settings.growthBonus),
    });
    await this.applySettings(next, false, false);
    if (runtimeAvailable()) {
      await emitTo("settings", "pet://settings-changed", this.settings);
    }
  }

  private startHitTesting(): void {
    window.setInterval(() => {
      void this.updateHitTest();
    }, HIT_TEST_MS);
  }

  private async updateHitTest(): Promise<void> {
    if (this.drag !== null || this.fileDragActive) return;
    const snapshot = await this.readPointerGeometry();
    if (snapshot === null) return;
    const { cursor, geometry } = snapshot;
    const overOpaquePixel = hitTestAlphaMask(
      this.currentMask,
      { x: cursor.x - geometry.x, y: cursor.y - geometry.y },
      { x: 0, y: 0, width: geometry.width, height: geometry.height },
    );
    const ignore = !overOpaquePixel;
    if (ignore !== this.lastIgnoreCursor) {
      await this.setCursorPassthrough(ignore).catch(() => undefined);
    }
  }

  private async readPointerGeometry(): Promise<{
    cursor: GlobalPointerState;
    geometry: WindowGeometry;
  } | null> {
    try {
      const [cursor, geometry] = await Promise.all([
        getGlobalPointerState(),
        getWindowGeometry("pet"),
      ]);
      return { cursor, geometry };
    } catch {
      return null;
    }
  }

  private async setCursorPassthrough(ignore: boolean): Promise<void> {
    this.lastIgnoreCursor = ignore;
    await setIgnoreCursorEvents("pet", ignore);
  }

  private startRoamWatcher(): void {
    window.setInterval(() => {
      if (
        !this.paused &&
        this.settings.autoRoam &&
        this.roam === null &&
        this.drag === null &&
        !this.fileDragActive &&
        Date.now() - this.lastInteraction >= ROAM_IDLE_MS
      ) {
        void this.startRoaming();
      }
    }, 1_000);
  }

  private async startRoaming(): Promise<void> {
    if (this.roam !== null) return;
    this.stopOccasionalAttentionTracking();
    const plan = createRoamPlan();
    const now = performance.now();
    this.stateMachine.setIntent("roam", {
      kind: "animation",
      animation: plan.direction === 1 ? "running-right" : "running-left",
    });
    const roam: RoamState = {
      direction: plan.direction,
      stopAt: now + plan.durationMs,
      lastTick: now,
      timer: 0,
    };
    roam.timer = window.setInterval(() => void this.roamTick(), ROAM_TICK_MS);
    this.roam = roam;
  }

  private async roamTick(): Promise<void> {
    const roam = this.roam;
    if (roam === null) return;
    const now = performance.now();
    if (now >= roam.stopAt) {
      this.stopRoaming();
      return;
    }
    const geometry = await getWindowGeometry("pet");
    const area = workArea(geometry);
    const step = stepHorizontalRoam({
      position: { x: geometry.x, y: geometry.y },
      direction: roam.direction,
      speedPxPerSecond: ROAM_SPEED_LOGICAL_PX_PER_SECOND * geometry.scaleFactor,
      elapsedMs: now - roam.lastTick,
      windowSize: { width: geometry.width, height: geometry.height },
      workArea: area,
      margin: WINDOW_MARGIN_LOGICAL_PX * geometry.scaleFactor,
    });
    roam.lastTick = now;
    if (step.direction !== roam.direction) {
      roam.direction = step.direction;
      this.stateMachine.setIntent("roam", {
        kind: "animation",
        animation: roam.direction === 1 ? "running-right" : "running-left",
      });
    }
    await moveWindow("pet", step.position.x, step.position.y);
  }

  private stopRoaming(): void {
    if (this.roam !== null) {
      window.clearInterval(this.roam.timer);
      this.roam = null;
    }
    this.stateMachine.clearIntent("roam");
    this.noteInteraction();
  }

  private scheduleAmbient(): void {
    if (this.ambientTimer !== null) window.clearTimeout(this.ambientTimer);
    this.ambientTimer = window.setTimeout(() => {
      if (
        !this.paused &&
        this.roam === null &&
        this.drag === null &&
        !this.fileDragActive &&
        this.stateMachine.current.source === "idle"
      ) {
        const animation = pickAmbientAnimation();
        this.stateMachine.setIdlePose({ kind: "animation", animation });
        window.setTimeout(
          () => this.stateMachine.setIdlePose({ kind: "animation", animation: "idle" }),
          actionHoldDurationMs(this.manifest, animation),
        );
      }
      this.scheduleAmbient();
    }, randomBetween(8_000, 16_000));
  }

  private async restorePosition(): Promise<void> {
    if (this.settings.windowPosition !== null) {
      await moveWindow(
        "pet",
        this.settings.windowPosition.x,
        this.settings.windowPosition.y,
      ).catch(() => undefined);
    }
    await this.ensureVisibleAtBottom(this.settings.windowPosition === null);
  }

  private async ensureVisibleAtBottom(forceBottom: boolean): Promise<void> {
    const geometry = await getWindowGeometry("pet");
    const area = workArea(geometry);
    const margin = WINDOW_MARGIN_LOGICAL_PX * geometry.scaleFactor;
    const grounded = groundedWindowPosition(
      forceBottom ? area.x + area.width - geometry.width - margin : geometry.x,
      { width: geometry.width, height: geometry.height },
      area,
      margin,
    );
    const x = forceBottom
      ? grounded.x
      : Math.min(area.x + area.width - geometry.width - margin, Math.max(area.x + margin, geometry.x));
    const y = forceBottom
      ? grounded.y
      : Math.min(area.y + area.height - geometry.height - margin, Math.max(area.y + margin, geometry.y));
    await moveWindow("pet", x, y);
  }

  private async resetPosition(): Promise<void> {
    await this.ensureVisibleAtBottom(true);
    const geometry = await getWindowGeometry("pet");
    this.settings = updateSettings(this.settings, {
      windowPosition: {
        x: geometry.x,
        y: geometry.y,
        monitorId: geometry.monitorName ?? undefined,
      },
    });
    await saveSettings(this.settings);
  }
}

async function atlasPixels(image: HTMLImageElement, manifest: PetManifest): Promise<ImageData> {
  if (
    image.naturalWidth !== manifest.spritesheet.width ||
    image.naturalHeight !== manifest.spritesheet.height
  ) {
    throw new Error(
      `糕糕图集尺寸不匹配：实际 ${image.naturalWidth}×${image.naturalHeight}，清单 ${manifest.spritesheet.width}×${manifest.spritesheet.height}`,
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = manifest.spritesheet.width;
  canvas.height = manifest.spritesheet.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("无法读取糕糕图集");
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export async function initPetWindow(): Promise<void> {
  const app = document.querySelector<HTMLElement>("#app")!;
  app.innerHTML = `<div class="pet-stage"><canvas class="pet-canvas" id="pet-canvas" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" aria-label="糕糕桌宠"></canvas></div>`;
  const canvas = document.querySelector<HTMLCanvasElement>("#pet-canvas")!;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: false });
  if (context === null) throw new Error("无法创建糕糕画布");

  const manifest = await loadPetManifest();
  const atlas = await loadImage(manifest.spritesheet.src);
  const pixels = await atlasPixels(atlas, manifest);
  const settings = await loadSettings();
  const controller = new PetController(canvas, context, manifest, atlas, pixels, settings);
  await controller.start();
}
