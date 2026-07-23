import { getCurrentWindow } from "@tauri-apps/api/window";
import { runtimeAvailable } from "./app/native";
import "./styles.css";

type AppWindow = "pet" | "settings";

function currentWindow(): AppWindow {
  const requested = new URLSearchParams(window.location.search).get("window");
  if (requested === "pet" || requested === "settings") {
    return requested;
  }
  if (runtimeAvailable()) {
    const label = getCurrentWindow().label;
    if (label === "settings") return label;
  }
  return "pet";
}

async function boot(): Promise<void> {
  const label = currentWindow();
  document.documentElement.dataset.window = label;
  document.documentElement.dataset.bootState = "booting";

  if (label === "settings") {
    const { initSettingsWindow } = await import("./windows/settings");
    await initSettingsWindow();
  } else {
    const { initPetWindow } = await import("./windows/pet");
    await initPetWindow();
  }
  document.documentElement.dataset.bootState = "ready";
}

void boot().catch((error: unknown) => {
  document.documentElement.dataset.bootState = "fatal";
  const message = error instanceof Error ? error.message : String(error);
  document.querySelector<HTMLElement>("#app")!.innerHTML =
    `<section class="fatal"><strong>糕糕没能醒来</strong><small>${message}</small></section>`;
  console.error(error);
});
