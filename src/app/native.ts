import { invoke } from "@tauri-apps/api/core";

export type WindowLabel = "pet" | "bubble" | "settings";

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface MonitorWorkArea extends Rect {
  name?: string | null;
}

export interface WindowGeometry extends Rect {
  scaleFactor: number;
  monitorName?: string | null;
  workArea?: MonitorWorkArea | null;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function getCursorPosition(): Promise<Point> {
  if (!isTauriRuntime()) {
    return { x: window.screenX, y: window.screenY };
  }
  return invoke<Point>("get_cursor_position");
}

export async function getWindowGeometry(label: WindowLabel): Promise<WindowGeometry> {
  if (!isTauriRuntime()) {
    return {
      x: window.screenX,
      y: window.screenY,
      width: window.outerWidth,
      height: window.outerHeight,
      scaleFactor: window.devicePixelRatio || 1,
      workArea: {
        x: 0,
        y: 0,
        width: window.screen.availWidth,
        height: window.screen.availHeight,
      },
    };
  }
  return invoke<WindowGeometry>("get_window_geometry", { label });
}

export async function moveWindow(label: WindowLabel, x: number, y: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("move_window", { label, x: Math.round(x), y: Math.round(y) });
}

export async function resizeWindow(
  label: WindowLabel,
  width: number,
  height: number,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("resize_window", {
    label,
    width: Math.round(width),
    height: Math.round(height),
  });
}

export async function placeBubble(
  x: number,
  y: number,
  width = 280,
  height = 104,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("place_bubble", {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  });
}

export async function showBubble(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("show_bubble");
}

export async function hideBubble(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("hide_bubble");
}

export async function showSettings(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("show_settings");
}

export async function setPetVisible(visible: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("set_pet_visible", { visible });
}

export async function setIgnoreCursorEvents(
  label: WindowLabel,
  ignore: boolean,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("set_ignore_cursor_events", { label, ignore });
}

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("set_always_on_top", { enabled });
}

export async function getAlwaysOnTop(): Promise<boolean> {
  return isTauriRuntime() ? invoke<boolean>("get_always_on_top") : true;
}

export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("set_launch_at_login", { enabled });
}

export async function getLaunchAtLogin(): Promise<boolean> {
  return isTauriRuntime() ? invoke<boolean>("get_launch_at_login") : false;
}

export async function showPetMenu(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("show_pet_menu");
}

export function runtimeAvailable(): boolean {
  return isTauriRuntime();
}
