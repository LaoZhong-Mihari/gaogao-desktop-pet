import { getCurrentWindow } from "@tauri-apps/api/window";
import { runtimeAvailable } from "./app/native";
import "./styles.css";

type AppWindow = "pet" | "bubble" | "settings";

function currentWindow(): AppWindow {
  const requested = new URLSearchParams(window.location.search).get("window");
  if (requested === "pet" || requested === "bubble" || requested === "settings") {
    return requested;
  }
  if (runtimeAvailable()) {
    const label = getCurrentWindow().label;
    if (label === "bubble" || label === "settings") return label;
  }
  return "pet";
}

async function boot(): Promise<void> {
  const label = currentWindow();
  document.documentElement.dataset.window = label;

  if (label === "bubble") {
    const { initBubbleWindow } = await import("./windows/bubble");
    await initBubbleWindow();
  } else if (label === "settings") {
    const { initSettingsWindow } = await import("./windows/settings");
    await initSettingsWindow();
  } else {
    const { initPetWindow } = await import("./windows/pet");
    await initPetWindow();
  }
}

void boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  document.querySelector<HTMLElement>("#app")!.innerHTML =
    `<section class="fatal"><strong>糕糕没能醒来</strong><small>${message}</small></section>`;
  console.error(error);
});
