import { emitTo, listen } from "@tauri-apps/api/event";
import {
  DEFAULT_PHRASES,
  PetStateMachine,
  animationDurationMs,
  animationFrameRect,
  createRoamPlan,
  extractAlphaMask,
  groundedWindowPosition,
  hitTestAlphaMask,
  loadPetManifest,
  lookDirectionFrameRect,
  pickAmbientAnimation,
  quantizeScreenDirection,
  stepHorizontalRoam,
  updateSettings,
  type ActivePetState,
  type AlphaMask,
  type BaseAnimationId,
  type HorizontalDirection,
  type PetManifest,
  type PetSettings,
  type PixelRect,
} from "../core";
import { loadSettings, saveSettings } from "../app/store";
import {
  getCursorPosition,
  getWindowGeometry,
  hideBubble,
  moveWindow,
  placeBubble,
  resizeWindow,
  runtimeAvailable,
  setAlwaysOnTop,
  setIgnoreCursorEvents,
  setLaunchAtLogin,
  setPetVisible,
  showBubble,
  showPetMenu,
  showSettings,
  type WindowGeometry,
} from "../app/native";

const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 208;
const DRAG_THRESHOLD_PX = 5;
const DOUBLE_CLICK_MS = 260;
const LOOK_POLL_MS = 110;
const HIT_TEST_MS = 45;
const ROAM_IDLE_MS = 45_000;
const ROAM_TICK_MS = 50;
const ROAM_SPEED_LOGICAL_PX_PER_SECOND = 28;
const WINDOW_MARGIN_LOGICAL_PX = 12;

interface DragState {
  pointerId: number;
  startCursorX: number;
  startCursorY: number;
  startWindowX: number;
  startWindowY: number;
  moved: boolean;
  lastCursorX: number;
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
  private bubbleTimer: number | null = null;
  private clickTimer: number | null = null;
  private drag: DragState | null = null;
  private roam: RoamState | null = null;
  private paused = false;
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
    await this.applySettings(this.settings, true);
    await this.restorePosition();
    this.renderState(this.stateMachine.current);
    this.startLookPolling();
    this.startHitTesting();
    this.startRoamWatcher();
    this.scheduleAmbient();
    this.scheduleBubble(2_400);
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
    this.stateMachine.setIntent(
      "direct",
      { kind: "animation", animation },
      animationDurationMs(this.manifest, animation),
    );
  }

  private noteInteraction(): void {
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
    event.preventDefault();
    this.noteInteraction();
    this.stopRoaming();
    await setIgnoreCursorEvents("pet", false);
    const [cursor, geometry] = await Promise.all([
      getCursorPosition(),
      getWindowGeometry("pet"),
    ]);
    this.drag = {
      pointerId: event.pointerId,
      startCursorX: cursor.x,
      startCursorY: cursor.y,
      startWindowX: geometry.x,
      startWindowY: geometry.y,
      moved: false,
      lastCursorX: cursor.x,
    };
    this.canvas.setPointerCapture(event.pointerId);
  }

  private async pointerMove(): Promise<void> {
    const drag = this.drag;
    if (drag === null) return;
    const cursor = await getCursorPosition();
    const dx = cursor.x - drag.startCursorX;
    const dy = cursor.y - drag.startCursorY;
    if (!drag.moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      drag.moved = true;
      this.canvas.classList.add("is-dragging");
    }
    if (!drag.moved) return;
    const horizontal = cursor.x - drag.lastCursorX;
    drag.lastCursorX = cursor.x;
    this.stateMachine.setIntent("direct", {
      kind: "animation",
      animation: horizontal < 0 ? "running-left" : "running-right",
    });
    await moveWindow("pet", drag.startWindowX + dx, drag.startWindowY + dy);
    await hideBubble();
  }

  private async pointerUp(event: PointerEvent): Promise<void> {
    const drag = this.drag;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.canvas.classList.remove("is-dragging");
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.stateMachine.clearIntent("direct");
    if (drag.moved) {
      const geometry = await getWindowGeometry("pet");
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
    await listen("command://say-phrase", () => void this.sayPhrase());
    await listen("command://reset-position", () => void this.resetPosition());
    await listen<boolean>("tray://pause-changed", ({ payload }) => this.setPaused(payload));
    await listen("tray://say-phrase", () => void this.sayPhrase());
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
    const previousScale = this.settings.scale;
    this.settings = next;
    const writes: Promise<unknown>[] = [saveSettings(next)];
    if (syncNative) {
      writes.push(
        setAlwaysOnTop(next.alwaysOnTop),
        setLaunchAtLogin(next.launchAtLogin),
      );
    }
    await Promise.all(writes);
    if (initial || previousScale !== next.scale) {
      const geometry = await getWindowGeometry("pet");
      await resizeWindow(
        "pet",
        FRAME_WIDTH * next.scale * geometry.scaleFactor,
        FRAME_HEIGHT * next.scale * geometry.scaleFactor,
      );
      await this.ensureVisibleAtBottom(false);
    }
    if (!next.followCursor) this.stateMachine.clearIntent("look");
    if (!next.autoRoam) this.stopRoaming();
    if (!next.bubblesEnabled) await hideBubble();
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.canvas.classList.toggle("is-paused", paused);
    if (paused) {
      this.stopRoaming();
      this.stateMachine.resetTransientIntents();
      this.stateMachine.setIdlePose({ kind: "animation", animation: "idle" });
      this.animationRevision += 1;
      if (this.animationTimer !== null) window.clearTimeout(this.animationTimer);
      void hideBubble();
    } else {
      this.renderState(this.stateMachine.current);
      this.noteInteraction();
    }
  }

  private startLookPolling(): void {
    window.setInterval(() => {
      if (this.paused || !this.settings.followCursor) {
        this.stateMachine.clearIntent("look");
        return;
      }
      void Promise.all([getCursorPosition(), getWindowGeometry("pet")]).then(
        ([cursor, geometry]) => {
          const direction = quantizeScreenDirection(
            cursor.x - (geometry.x + geometry.width / 2),
            cursor.y - (geometry.y + geometry.height / 2),
            24 * geometry.scaleFactor,
          );
          if (direction === null) this.stateMachine.clearIntent("look");
          else this.stateMachine.setIntent("look", { kind: "look", direction });
        },
      );
    }, LOOK_POLL_MS);
  }

  private startHitTesting(): void {
    window.setInterval(() => {
      void this.updateHitTest();
    }, HIT_TEST_MS);
  }

  private async updateHitTest(): Promise<void> {
    if (this.drag !== null) return;
    const [cursor, geometry] = await Promise.all([
      getCursorPosition(),
      getWindowGeometry("pet"),
    ]);
    const overOpaquePixel = hitTestAlphaMask(
      this.currentMask,
      { x: cursor.x - geometry.x, y: cursor.y - geometry.y },
      { x: 0, y: 0, width: geometry.width, height: geometry.height },
    );
    const ignore = !overOpaquePixel;
    if (ignore !== this.lastIgnoreCursor) {
      this.lastIgnoreCursor = ignore;
      await setIgnoreCursorEvents("pet", ignore);
    }
  }

  private startRoamWatcher(): void {
    window.setInterval(() => {
      if (
        !this.paused &&
        this.settings.autoRoam &&
        this.roam === null &&
        this.drag === null &&
        Date.now() - this.lastInteraction >= ROAM_IDLE_MS
      ) {
        void this.startRoaming();
      }
    }, 1_000);
  }

  private async startRoaming(): Promise<void> {
    if (this.roam !== null) return;
    const plan = createRoamPlan();
    const now = performance.now();
    await hideBubble();
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
      if (!this.paused && this.roam === null && this.drag === null) {
        const animation = pickAmbientAnimation();
        this.stateMachine.setIdlePose({ kind: "animation", animation });
        window.setTimeout(
          () => this.stateMachine.setIdlePose({ kind: "animation", animation: "idle" }),
          animationDurationMs(this.manifest, animation),
        );
      }
      this.scheduleAmbient();
    }, randomBetween(8_000, 16_000));
  }

  private scheduleBubble(delay = randomBetween(120_000, 300_000)): void {
    if (this.bubbleTimer !== null) window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => {
      void this.sayPhrase();
      this.scheduleBubble();
    }, delay);
  }

  private async sayPhrase(): Promise<void> {
    if (!runtimeAvailable() || this.paused || !this.settings.bubblesEnabled) return;
    const phrases = this.settings.customPhrases.length
      ? this.settings.customPhrases
      : DEFAULT_PHRASES;
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    const geometry = await getWindowGeometry("pet");
    const area = workArea(geometry);
    const bubbleWidth = Math.round(280 * geometry.scaleFactor);
    const bubbleHeight = Math.round(104 * geometry.scaleFactor);
    const x = Math.min(
      area.x + area.width - bubbleWidth,
      Math.max(area.x, geometry.x + geometry.width / 2 - bubbleWidth / 2),
    );
    const above = geometry.y - bubbleHeight + 18 * geometry.scaleFactor;
    const y = above >= area.y
      ? above
      : Math.min(area.y + area.height - bubbleHeight, geometry.y + geometry.height - 10);
    await placeBubble(x, y, bubbleWidth, bubbleHeight);
    await emitTo("bubble", "bubble://show", { phrase, durationMs: 4_500 });
    await showBubble();
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
