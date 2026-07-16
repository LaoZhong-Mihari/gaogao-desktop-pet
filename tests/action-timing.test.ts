import { describe, expect, it } from "vitest";

import manifestData from "../public/data/pet.manifest.json";
import {
  GROOMING_REPEAT_COUNT,
  actionHoldDurationMs,
} from "../src/core/action-timing";
import { parsePetManifest } from "../src/core/manifest";

describe("action timing", () => {
  const manifest = parsePetManifest(manifestData);

  it("keeps grooming visible for four complete cycles", () => {
    expect(GROOMING_REPEAT_COUNT).toBe(4);
    expect(actionHoldDurationMs(manifest, "grooming")).toBe(5_600);
  });

  it("keeps ordinary actions at one manifest cycle", () => {
    expect(actionHoldDurationMs(manifest, "waving")).toBe(700);
  });
});
