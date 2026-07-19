import { describe, expect, it, vi } from "vitest";

import manifestData from "../public/data/pet.manifest.json";
import {
  animationDurationMs,
  animationFrameRect,
  loadPetManifest,
  lookDirectionFrameRect,
  ManifestValidationError,
  parsePetManifest,
  parsePetManifestJson,
  validatePetManifest,
} from "../src/core/manifest";

function copyManifest(): Record<string, any> {
  return JSON.parse(JSON.stringify(manifestData)) as Record<string, any>;
}

describe("pet manifest", () => {
  it("parses the bundled 8x12 atlas with 16 image-drawn look frames", () => {
    const manifest = parsePetManifest(manifestData);
    expect(manifest.spritesheet).toMatchObject({
      width: 1536,
      height: 2496,
      columns: 8,
      rows: 12,
      frameWidth: 192,
      frameHeight: 208,
    });
    expect(Object.keys(manifest.animations)).toHaveLength(10);
    expect(manifest.lookDirections).toHaveLength(16);
    expect(manifest.neutralFrame).toEqual({ row: 0, column: 0 });
  });

  it("maps all ten base actions to their fixed rows and frame counts", () => {
    const manifest = parsePetManifest(manifestData);
    const expected = {
      idle: [0, 6],
      "running-right": [1, 8],
      "running-left": [2, 8],
      waving: [3, 4],
      jumping: [4, 5],
      failed: [5, 8],
      waiting: [6, 6],
      running: [7, 6],
      review: [8, 6],
      grooming: [11, 6],
    } as const;
    for (const [id, [row, frameCount]] of Object.entries(expected)) {
      const animation = manifest.animations[id as keyof typeof expected];
      expect(animation.row).toBe(row);
      expect(animation.frames).toHaveLength(frameCount);
    }
  });

  it("computes animation duration and exact atlas rectangles", () => {
    const manifest = parsePetManifest(manifestData);
    expect(animationDurationMs(manifest, "waving")).toBe(700);
    expect(animationDurationMs(manifest, "idle")).toBe(6_600);
    expect(animationDurationMs(manifest, "grooming")).toBe(1400);
    expect(animationFrameRect(manifest, "running-right", 7)).toEqual({
      x: 1344,
      y: 208,
      width: 192,
      height: 208,
    });
    expect(animationFrameRect(manifest, "grooming", 5)).toEqual({
      x: 960,
      y: 2288,
      width: 192,
      height: 208,
    });
    expect(lookDirectionFrameRect(manifest, 15)).toEqual({
      x: 1344,
      y: 2080,
      width: 192,
      height: 208,
    });
    expect(manifest.animations.grooming.loop).toBe(true);
    expect(() => animationFrameRect(manifest, "waving", 99)).toThrow(RangeError);
  });

  it("rejects inconsistent grid dimensions and remote spritesheets", () => {
    const invalid = copyManifest();
    invalid.spritesheet.width = 1500;
    invalid.spritesheet.src = "https://example.test/cat.webp";
    const issues = validatePetManifest(invalid);
    expect(issues).toContain("spritesheet.width must equal columns * frameWidth");
    expect(issues).toContain("spritesheet.src must be a bundled local asset path");
    expect(() => parsePetManifest(invalid)).toThrow(ManifestValidationError);
  });

  it("rejects missing animations and duplicate animation frames", () => {
    const invalid = copyManifest();
    delete invalid.animations.jumping;
    invalid.animations.waving.frames[1].column = 0;
    const issues = validatePetManifest(invalid);
    expect(issues).toContain("animations.jumping must be an object");
    expect(issues).toContain(
      "animations.waving.frames[1].column is duplicated within the animation",
    );
  });

  it("keeps animation rows out of the fixed direction rows", () => {
    const invalid = copyManifest();
    invalid.animations.grooming.row = 9;
    expect(validatePetManifest(invalid)).toContain("animations.grooming.row must be 11");
  });

  it("rejects incomplete, misordered, and duplicate look direction cells", () => {
    const incomplete = copyManifest();
    incomplete.lookDirections.pop();
    expect(validatePetManifest(incomplete)).toContain(
      "lookDirections must contain exactly 16 entries",
    );

    const invalid = copyManifest();
    invalid.lookDirections[1].degrees = 45;
    invalid.lookDirections[1].row = 11;
    invalid.lookDirections[1].column = 0;
    const issues = validatePetManifest(invalid);
    expect(issues).toContain("lookDirections[1].degrees must be 22.5");
    expect(issues).toContain("lookDirections[1].row must be 9");
    expect(issues).toContain("lookDirections[1].column must be 1");

    const duplicate = copyManifest();
    duplicate.lookDirections[1].column = 0;
    expect(validatePetManifest(duplicate)).toContain(
      "lookDirections[1] reuses atlas cell 9:0",
    );
  });

  it("wraps malformed JSON in a manifest validation error", () => {
    expect(() => parsePetManifestJson("{"))
      .toThrow(ManifestValidationError);
  });

  it("loads through an injectable local fetcher and reports HTTP failure", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => manifestData,
    }));
    await expect(loadPetManifest("/data/pet.manifest.json", fetcher)).resolves.toMatchObject({
      id: "gaogao",
    });
    expect(fetcher).toHaveBeenCalledWith("/data/pet.manifest.json");

    await expect(
      loadPetManifest("/missing.json", async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
      })),
    ).rejects.toThrow("Unable to load pet manifest (404)");
  });
});
