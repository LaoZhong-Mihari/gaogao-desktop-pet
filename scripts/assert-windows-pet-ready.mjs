#!/usr/bin/env node

const port = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("Usage: node scripts/assert-windows-pet-ready.mjs <debug-port>");
  process.exit(2);
}

const deadline = Date.now() + 30_000;
const endpoint = `http://127.0.0.1:${port}/json/list`;
let lastObservation = `WebView2 DevTools endpoint ${endpoint} is not available`;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function evaluateTarget(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const requestId = 1;

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out opening the WebView2 DevTools socket")),
        5_000,
      );
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("Unable to open the WebView2 DevTools socket"));
      });
    });

    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out evaluating the pet document")),
        5_000,
      );
      socket.addEventListener("message", async (event) => {
        const text =
          typeof event.data === "string" ? event.data : await event.data.text();
        const message = JSON.parse(text);
        if (message.id !== requestId) return;
        clearTimeout(timeout);
        resolve(message);
      });
    });

    socket.send(
      JSON.stringify({
        id: requestId,
        method: "Runtime.evaluate",
        params: {
          expression: `(() => ({
            window: document.documentElement.dataset.window ?? null,
            bootState: document.documentElement.dataset.bootState ?? null,
            fatal: document.querySelector(".fatal")?.textContent?.trim() ?? null,
            hasCanvas: Boolean(document.querySelector("#pet-canvas"))
          }))()`,
          returnByValue: true,
        },
      }),
    );

    const message = await response;
    if (message.error) {
      throw new Error(`DevTools evaluation failed: ${JSON.stringify(message.error)}`);
    }
    return message.result?.result?.value ?? null;
  } finally {
    socket.close();
  }
}

while (Date.now() < deadline) {
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`DevTools endpoint returned HTTP ${response.status}`);
    }
    const targets = await response.json();
    for (const target of targets) {
      if (target.type !== "page" || !target.webSocketDebuggerUrl) continue;
      const observation = await evaluateTarget(target);
      if (observation?.window !== "pet") continue;

      lastObservation = JSON.stringify(observation);
      if (observation.bootState === "fatal" || observation.fatal) {
        throw new Error(`Gaogao rendered a fatal startup page: ${lastObservation}`);
      }
      if (observation.bootState === "ready" && observation.hasCanvas) {
        console.log(`Gaogao frontend is ready: ${lastObservation}`);
        process.exit(0);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("Gaogao rendered a fatal startup page:")) {
      console.error(message);
      process.exit(1);
    }
    lastObservation = message;
  }
  await sleep(500);
}

console.error(`Gaogao frontend did not become ready: ${lastObservation}`);
process.exit(1);
