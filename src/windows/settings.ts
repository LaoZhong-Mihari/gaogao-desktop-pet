import { emitTo, listen } from "@tauri-apps/api/event";
import {
  PET_SCALES,
  updateSettings,
  type PetSettings,
} from "../core/settings";
import { loadSettings, saveSettings } from "../app/store";
import {
  ensureFoodToken,
  getAlwaysOnTop,
  getLaunchAtLogin,
  runtimeAvailable,
  setAlwaysOnTop,
  setLaunchAtLogin,
} from "../app/native";

function settingsMarkup(settings: PetSettings): string {
  const scaleOptions = PET_SCALES.map(
    (scale) =>
      `<option value="${scale}" ${settings.scale === scale ? "selected" : ""}>${Math.round(scale * 100)}%</option>`,
  ).join("");
  const growthPercent = Math.round(settings.growthBonus * 100);

  return `
    <section class="settings-shell">
      <header><div class="mini-cat" aria-hidden="true"></div><div><h1>糕糕桌宠</h1><p>所有设置只保存在本机。</p></div></header>
      <form id="settings-form">
        <fieldset><legend>外观与行为</legend>
          <label class="select-row"><span>基础大小</span><select name="scale">${scaleOptions}</select></label>
          <div class="growth-row"><span>吃猫条长大</span><strong>+${growthPercent}%</strong></div>
          ${toggle("alwaysOnTop", "始终置顶", settings.alwaysOnTop)}
          ${toggle("attentionEnabled", "偶尔注意鼠标和文件", settings.attentionEnabled)}
          ${toggle("autoRoam", "空闲后从当前位置左右漫步", settings.autoRoam)}
          ${toggle("launchAtLogin", "登录时自动启动", settings.launchAtLogin)}
        </fieldset>
        <fieldset class="feeding-settings"><legend>喂糕糕</legend>
          <p>把桌面上的猫条图片拖进糕糕窗口。验证成功后会直接长大 2–5%，最多长大 50%。</p>
          <div class="food-token-row"><button type="button" id="place-food-token">把猫条放到桌面</button><span id="food-token-status" role="status"></span></div>
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
    attentionEnabled: data.get("attentionEnabled") === "on",
    autoRoam: data.get("autoRoam") === "on",
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

    document.querySelector<HTMLButtonElement>("#place-food-token")!.addEventListener("click", () => {
      const status = document.querySelector<HTMLElement>("#food-token-status")!;
      status.textContent = "正在准备猫条…";
      void ensureFoodToken()
        .then(() => {
          status.textContent = "猫条已放到桌面";
        })
        .catch(() => {
          status.textContent = "没能放好猫条，请稍后再试";
        });
    });
    document.querySelector<HTMLButtonElement>("#reset-position")!.addEventListener("click", () => {
      if (runtimeAvailable()) void emitTo("pet", "command://reset-position");
    });
  };

  if (runtimeAvailable()) {
    await listen<PetSettings>("pet://settings-changed", ({ payload }) => {
      settings = updateSettings(settings, { ...payload });
      void saveSettings(settings).then(render);
    });
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
