import { describe, expect, it } from "vitest";

import {
  DEFAULT_PHRASES,
  DEFAULT_SETTINGS,
  normalizePhrases,
  normalizeSettings,
  normalizeWindowPosition,
  resetPhrases,
  updateSettings,
} from "../src/core/settings";

describe("settings normalization", () => {
  it("supplies safe defaults, with launch-at-login disabled", () => {
    const settings = normalizeSettings(undefined);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.launchAtLogin).toBe(false);
    expect(settings.customPhrases).not.toBe(DEFAULT_SETTINGS.customPhrases);
  });

  it("keeps only supported scales and real booleans", () => {
    expect(normalizeSettings({ scale: 1.25, autoRoam: false })).toMatchObject({
      scale: 1.25,
      autoRoam: false,
    });
    expect(normalizeSettings({ scale: 2, alwaysOnTop: "yes" })).toMatchObject({
      scale: 1,
      alwaysOnTop: true,
    });
  });

  it("sanitizes, deduplicates, and bounds local phrases", () => {
    const long = "糕".repeat(100);
    expect(normalizePhrases([" 你好 ", "你好", "", 42, long])).toEqual([
      "你好",
      "糕".repeat(80),
    ]);
    expect(normalizePhrases([])).toEqual([]);
    expect(normalizePhrases("invalid")).toEqual(DEFAULT_PHRASES);
  });

  it("accepts finite multi-monitor positions and rejects corrupt positions", () => {
    expect(normalizeWindowPosition({ x: -1440.5, y: 200, monitorId: " secondary " })).toEqual({
      x: -1440.5,
      y: 200,
      monitorId: "secondary",
    });
    expect(normalizeWindowPosition({ x: Number.NaN, y: 2 })).toBeNull();
    expect(normalizeWindowPosition({ x: 1, y: Infinity })).toBeNull();
  });

  it("applies partial updates without resetting unrelated settings", () => {
    const current = normalizeSettings({
      scale: 1.5,
      followCursor: false,
      customPhrases: ["糕糕在这里"],
    });
    const updated = updateSettings(current, { autoRoam: false });
    expect(updated).toMatchObject({
      scale: 1.5,
      followCursor: false,
      autoRoam: false,
      customPhrases: ["糕糕在这里"],
    });
    expect(resetPhrases(updated).customPhrases).toEqual(DEFAULT_PHRASES);
  });
});
