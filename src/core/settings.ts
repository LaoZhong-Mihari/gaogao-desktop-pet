export const PET_SCALES = [0.75, 1, 1.25, 1.5] as const;
export type PetScale = (typeof PET_SCALES)[number];

export const DEFAULT_PHRASES = [
  "今天也先这样吧。",
  "我只是趴一会儿。",
  "事情会自己做完吗？",
  "再看五分钟。",
  "你忙你的。",
  "糕糕正在认真发呆。",
  "这不是偷懒，是节能。",
  "风从屏幕那边吹来了。",
  "好像该吃点什么。",
  "我有在听。大概。",
  "先趴下，再想办法。",
  "今天的进度：活着。",
] as const;

export interface SavedWindowPosition {
  readonly x: number;
  readonly y: number;
  readonly monitorId?: string;
}

export interface PetSettings {
  readonly scale: PetScale;
  readonly alwaysOnTop: boolean;
  readonly followCursor: boolean;
  readonly autoRoam: boolean;
  readonly bubblesEnabled: boolean;
  readonly launchAtLogin: boolean;
  readonly customPhrases: readonly string[];
  readonly windowPosition: SavedWindowPosition | null;
}

export const DEFAULT_SETTINGS: PetSettings = Object.freeze({
  scale: 1,
  alwaysOnTop: true,
  followCursor: true,
  autoRoam: true,
  bubblesEnabled: true,
  launchAtLogin: false,
  customPhrases: Object.freeze([...DEFAULT_PHRASES]),
  windowPosition: null,
});

const MAX_PHRASES = 100;
const MAX_PHRASE_LENGTH = 80;
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

export function normalizePhrases(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_PHRASES];
  }

  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const phrase = item.trim().slice(0, MAX_PHRASE_LENGTH);
    if (phrase === "" || seen.has(phrase)) {
      continue;
    }
    seen.add(phrase);
    phrases.push(phrase);
    if (phrases.length === MAX_PHRASES) {
      break;
    }
  }
  return phrases;
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
  return {
    scale: normalizeScale(source.scale),
    alwaysOnTop: normalizeBoolean(source.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    followCursor: normalizeBoolean(source.followCursor, DEFAULT_SETTINGS.followCursor),
    autoRoam: normalizeBoolean(source.autoRoam, DEFAULT_SETTINGS.autoRoam),
    bubblesEnabled: normalizeBoolean(
      source.bubblesEnabled,
      DEFAULT_SETTINGS.bubblesEnabled,
    ),
    launchAtLogin: normalizeBoolean(source.launchAtLogin, DEFAULT_SETTINGS.launchAtLogin),
    customPhrases: normalizePhrases(source.customPhrases),
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

export function resetPhrases(settings: PetSettings): PetSettings {
  return { ...settings, customPhrases: [...DEFAULT_PHRASES] };
}
