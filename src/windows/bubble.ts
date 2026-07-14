import { listen } from "@tauri-apps/api/event";
import { hideBubble, runtimeAvailable, setIgnoreCursorEvents } from "../app/native";

interface BubblePayload {
  phrase: string;
  durationMs?: number;
}

export async function initBubbleWindow(): Promise<void> {
  const app = document.querySelector<HTMLElement>("#app")!;
  app.innerHTML = `<div class="speech-bubble" id="speech-bubble" role="status"></div>`;
  const bubble = document.querySelector<HTMLElement>("#speech-bubble")!;
  let hideTimer: number | null = null;

  await setIgnoreCursorEvents("bubble", true);

  if (!runtimeAvailable()) {
    bubble.textContent = "糕糕正在发呆。";
    bubble.classList.add("is-visible");
    return;
  }

  await listen<BubblePayload>("bubble://show", ({ payload }) => {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    bubble.textContent = payload.phrase;
    bubble.classList.remove("is-visible");
    requestAnimationFrame(() => bubble.classList.add("is-visible"));
    hideTimer = window.setTimeout(() => {
      bubble.classList.remove("is-visible");
      window.setTimeout(() => void hideBubble(), 160);
    }, payload.durationMs ?? 4_500);
  });

  await listen("bubble://hide", () => {
    if (hideTimer !== null) window.clearTimeout(hideTimer);
    bubble.classList.remove("is-visible");
    window.setTimeout(() => void hideBubble(), 160);
  });
}
