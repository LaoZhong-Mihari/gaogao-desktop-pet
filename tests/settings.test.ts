import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  MAX_GROWTH_BONUS,
  normalizeGrowthBonus,
  normalizeSettings,
  normalizeWindowPosition,
  updateSettings,
} from "../src/core/settings";

describe("settings normalization", () => {
  it("supplies safe defaults, with launch-at-login disabled", () => {
    const settings = normalizeSettings(undefined);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.launchAtLogin).toBe(false);
    expect(settings.attentionEnabled).toBe(true);
    expect(settings.growthBonus).toBe(0);
  });

  it("keeps only supported base scales and real booleans", () => {
    expect(normalizeSettings({ scale: 1.25, autoRoam: false })).toMatchObject({
      scale: 1.25,
      autoRoam: false,
    });
    expect(normalizeSettings({ scale: 2, alwaysOnTop: "yes" })).toMatchObject({
      scale: 1,
      alwaysOnTop: true,
    });
  });

  it("migrates the beta.4 look preference to non-directional attention", () => {
    expect(normalizeSettings({ followCursor: false }).attentionEnabled).toBe(true);
    expect(normalizeSettings({ lookEnabled: false }).attentionEnabled).toBe(false);
    expect(
      normalizeSettings({ lookEnabled: false, attentionEnabled: true }).attentionEnabled,
    ).toBe(true);
  });

  it("normalizes feeding growth into the supported range", () => {
    expect(normalizeGrowthBonus(0.23)).toBe(0.23);
    expect(normalizeGrowthBonus(-0.1)).toBe(0);
    expect(normalizeGrowthBonus(5)).toBe(MAX_GROWTH_BONUS);
    expect(normalizeGrowthBonus(Number.NaN)).toBe(0);
    expect(normalizeSettings({ growthBonus: 0.49 }).growthBonus).toBe(0.49);
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
      growthBonus: 0.12,
      attentionEnabled: false,
    });
    const updated = updateSettings(current, { autoRoam: false });
    expect(updated).toMatchObject({
      scale: 1.5,
      growthBonus: 0.12,
      attentionEnabled: false,
      autoRoam: false,
    });
  });
});
