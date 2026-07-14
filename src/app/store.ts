import { load, type Store } from "@tauri-apps/plugin-store";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type PetSettings,
} from "../core/settings";
import { runtimeAvailable } from "./native";

const SETTINGS_KEY = "pet-settings-v1";
let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  storePromise ??= load("settings.json", { defaults: {}, autoSave: 100 });
  return storePromise;
}

export async function loadSettings(): Promise<PetSettings> {
  if (!runtimeAvailable()) {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    try {
      return normalizeSettings(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  const store = await getStore();
  return normalizeSettings(await store.get<unknown>(SETTINGS_KEY));
}

export async function saveSettings(settings: PetSettings): Promise<void> {
  const normalized = normalizeSettings(settings);
  if (!runtimeAvailable()) {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    return;
  }

  const store = await getStore();
  await store.set(SETTINGS_KEY, normalized);
  await store.save();
}
