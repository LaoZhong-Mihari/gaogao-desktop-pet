import { emitTo, listen } from "@tauri-apps/api/event";
import {
  DEFAULT_PHRASES,
  PET_SCALES,
  normalizePhrases,
  updateSettings,
  type PetSettings,
} from "../core/settings";
import { loadSettings, saveSettings } from "../app/store";
import {
  getAlwaysOnTop,
  getLaunchAtLogin,
  runtimeAvailable,
  setAlwaysOnTop,
  setLaunchAtLogin,
} from "../app/native";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function settingsMarkup(settings: PetSettings): string {
  const scaleOptions = PET_SCALES.map(
    (scale) =>
      `<option value="${scale}" ${settings.scale === scale ? "selected" : ""}>${Math.round(scale * 100)}%</option>`,
  ).join("");
  const phrases = settings.customPhrases
    .map(
      (phrase, index) => `<li><input class="phrase-edit" data-edit-phrase="${index}" maxlength="80" value="${escapeHtml(phrase)}" aria-label="编辑短句 ${index + 1}" /><button type="button" class="icon-button" data-remove-phrase="${index}" aria-label="删除这句">×</button></li>`,
    )
    .join("");

  return `
    <section class="settings-shell">
      <header><div class="mini-cat" aria-hidden="true"></div><div><h1>糕糕桌宠</h1><p>所有设置与短句只保存在本机。</p></div></header>
      <form id="settings-form">
        <fieldset><legend>外观与行为</legend>
          <label class="select-row"><span>显示大小</span><select name="scale">${scaleOptions}</select></label>
          ${toggle("alwaysOnTop", "始终置顶", settings.alwaysOnTop)}
          ${toggle("followCursor", "看向鼠标", settings.followCursor)}
          ${toggle("autoRoam", "空闲后沿屏幕底部漫步", settings.autoRoam)}
          ${toggle("bubblesEnabled", "显示离线气泡", settings.bubblesEnabled)}
          ${toggle("launchAtLogin", "登录时自动启动", settings.launchAtLogin)}
        </fieldset>
        <fieldset><legend>糕糕会说</legend>
          <ul class="phrase-list" id="phrase-list">${phrases || "<li class=empty>还没有自定义短句</li>"}</ul>
          <div class="phrase-entry"><input id="new-phrase" maxlength="80" placeholder="添加一句话（最多 80 字）" /><button type="button" id="add-phrase">添加</button></div>
          <div class="button-row"><button type="button" class="secondary" id="restore-phrases">恢复默认短句</button><button type="button" class="secondary" id="say-now">现在说一句</button></div>
        </fieldset>
        <footer><span id="save-status">更改会自动保存</span><button type="button" class="secondary" id="reset-position">把糕糕移回屏幕底部</button></footer>
      </form>
    </section>`;
}

function toggle(name: keyof PetSettings, label: string, checked: boolean): string {
  return `<label class="toggle-row"><span>${label}</span><input type="checkbox" name="${name}" ${checked ? "checked" : ""} /><i aria-hidden="true"></i></label>`;
}

function formPatch(form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form);
  return {
    scale: Number(data.get("scale")),
    alwaysOnTop: data.get("alwaysOnTop") === "on",
    followCursor: data.get("followCursor") === "on",
    autoRoam: data.get("autoRoam") === "on",
    bubblesEnabled: data.get("bubblesEnabled") === "on",
    launchAtLogin: data.get("launchAtLogin") === "on",
  };
}

export async function initSettingsWindow(): Promise<void> {
  let settings = await loadSettings();
  settings = updateSettings(settings, {
    alwaysOnTop: await getAlwaysOnTop().catch(() => settings.alwaysOnTop),
    launchAtLogin: await getLaunchAtLogin().catch(() => settings.launchAtLogin),
  });
  const app = document.querySelector<HTMLElement>("#app")!;

  const render = (): void => {
    app.innerHTML = settingsMarkup(settings);
    wire();
  };

  const persist = async (next: PetSettings): Promise<void> => {
    settings = next;
    await saveSettings(settings);
    await setAlwaysOnTop(settings.alwaysOnTop);
    await setLaunchAtLogin(settings.launchAtLogin);
    if (runtimeAvailable()) {
      await emitTo("pet", "settings://changed", settings);
    }
    const status = document.querySelector<HTMLElement>("#save-status");
    if (status) {
      status.textContent = "已保存";
      window.setTimeout(() => (status.textContent = "更改会自动保存"), 1_200);
    }
  };

  const wire = (): void => {
    const form = document.querySelector<HTMLFormElement>("#settings-form")!;
    form.addEventListener("change", () => void persist(updateSettings(settings, formPatch(form))));

    document.querySelector<HTMLButtonElement>("#add-phrase")!.addEventListener("click", () => {
      const input = document.querySelector<HTMLInputElement>("#new-phrase")!;
      const phrases = normalizePhrases([...settings.customPhrases, input.value]);
      input.value = "";
      void persist({ ...settings, customPhrases: phrases }).then(render);
    });
    document.querySelector<HTMLInputElement>("#new-phrase")!.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>("#add-phrase")!.click();
      }
    });
    document.querySelectorAll<HTMLButtonElement>("[data-remove-phrase]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.removePhrase);
        void persist({
          ...settings,
          customPhrases: settings.customPhrases.filter((_, itemIndex) => itemIndex !== index),
        }).then(render);
      });
    });
    document.querySelectorAll<HTMLInputElement>("[data-edit-phrase]").forEach((input) => {
      input.addEventListener("change", () => {
        const index = Number(input.dataset.editPhrase);
        const phrases = [...settings.customPhrases];
        phrases[index] = input.value;
        void persist({ ...settings, customPhrases: normalizePhrases(phrases) }).then(render);
      });
    });
    document.querySelector<HTMLButtonElement>("#restore-phrases")!.addEventListener("click", () => {
      void persist({ ...settings, customPhrases: [...DEFAULT_PHRASES] }).then(render);
    });
    document.querySelector<HTMLButtonElement>("#say-now")!.addEventListener("click", () => {
      if (runtimeAvailable()) void emitTo("pet", "command://say-phrase");
    });
    document.querySelector<HTMLButtonElement>("#reset-position")!.addEventListener("click", () => {
      if (runtimeAvailable()) void emitTo("pet", "command://reset-position");
    });
  };

  if (runtimeAvailable()) {
    await listen<boolean>("tray://always-on-top-changed", ({ payload }) => {
      settings = updateSettings(settings, { alwaysOnTop: payload });
      void saveSettings(settings).then(render);
    });
    await listen<boolean>("tray://launch-at-login-changed", ({ payload }) => {
      settings = updateSettings(settings, { launchAtLogin: payload });
      void saveSettings(settings).then(render);
    });
  }

  render();
}
