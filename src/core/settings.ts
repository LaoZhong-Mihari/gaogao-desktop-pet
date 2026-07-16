export const PET_SCALES = [0.75, 1, 1.25, 1.5] as const;
export type PetScale = (typeof PET_SCALES)[number];

export const MAX_GROWTH_BONUS = 0.5;

export interface SavedWindowPosition {
  readonly x: number;
  readonly y: number;
  readonly monitorId?: string;
}

export interface PetSettings {
  readonly scale: PetScale;
  readonly growthBonus: number;
  readonly alwaysOnTop: boolean;
  readonly attentionEnabled: boolean;
  readonly autoRoam: boolean;
  readonly launchAtLogin: boolean;
  readonly windowPosition: SavedWindowPosition | null;
}

export const DEFAULT_SETTINGS: PetSettings = Object.freeze({
  scale: 1,
  growthBonus: 0,
  alwaysOnTop: true,
  attentionEnabled: true,
  autoRoam: true,
  launchAtLogin: false,
  windowPosition: null,
});

const MAX_MONITOR_ID_LENGTH = 128;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeScale(value: unknown): PetScale {
  return PET_SCALES.includes(value as PetScale) ? (value as PetScale) : DEFAULT_SETTINGS.scale;
}

export function normalizeGrowthBonus(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.growthBonus;
  }
  return Math.min(MAX_GROWTH_BONUS, Math.max(0, value));
}

export function normalizeWindowPosition(value: unknown): SavedWindowPosition | null {
  if (!isRecord(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    return null;
  }

  const position: { x: number; y: number; monitorId?: string } = {
    x: value.x as number,
    y: value.y as number,
  };
  if (typeof value.monitorId === "string") {
    const monitorId = value.monitorId.trim().slice(0, MAX_MONITOR_ID_LENGTH);
    if (monitorId !== "") {
      position.monitorId = monitorId;
    }
  }
  return position;
}

export function normalizeSettings(value: unknown): PetSettings {
  const source = isRecord(value) ? value : {};
  const legacyAttentionEnabled = normalizeBoolean(
    source.lookEnabled,
    DEFAULT_SETTINGS.attentionEnabled,
  );
  return {
    scale: normalizeScale(source.scale),
    growthBonus: normalizeGrowthBonus(source.growthBonus),
    alwaysOnTop: normalizeBoolean(source.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    // Preserve the beta.4 preference while retiring its generated direction art.
    attentionEnabled: normalizeBoolean(
      source.attentionEnabled,
      legacyAttentionEnabled,
    ),
    autoRoam: normalizeBoolean(source.autoRoam, DEFAULT_SETTINGS.autoRoam),
    launchAtLogin: normalizeBoolean(source.launchAtLogin, DEFAULT_SETTINGS.launchAtLogin),
    windowPosition: normalizeWindowPosition(source.windowPosition),
  };
}

/** Applies an untrusted partial update without resetting unspecified fields. */
export function updateSettings(
  current: PetSettings,
  patch: Readonly<Record<string, unknown>>,
): PetSettings {
  return normalizeSettings({ ...current, ...patch });
}
