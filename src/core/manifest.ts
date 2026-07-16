export const BASE_ANIMATION_IDS = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
  "grooming",
] as const;

export type BaseAnimationId = (typeof BASE_ANIMATION_IDS)[number];

export interface AtlasFrameReference {
  readonly row: number;
  readonly column: number;
}

export interface AnimationFrame {
  readonly column: number;
  readonly durationMs: number;
}

export interface AnimationDefinition {
  readonly row: number;
  readonly loop: boolean;
  readonly frames: readonly AnimationFrame[];
}

export interface SpritesheetDefinition {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

export interface PetManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly spritesheet: SpritesheetDefinition;
  readonly neutralFrame: AtlasFrameReference;
  readonly animations: Readonly<Record<BaseAnimationId, AnimationDefinition>>;
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class ManifestValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid pet manifest:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function validateFrameReference(
  value: unknown,
  path: string,
  sheet: UnknownRecord | null,
  issues: string[],
): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return;
  }

  const rows = sheet?.rows;
  const columns = sheet?.columns;
  if (!isNonNegativeInteger(value.row)) {
    issues.push(`${path}.row must be a non-negative integer`);
  } else if (isPositiveInteger(rows) && value.row >= rows) {
    issues.push(`${path}.row is outside the spritesheet`);
  }
  if (!isNonNegativeInteger(value.column)) {
    issues.push(`${path}.column must be a non-negative integer`);
  } else if (isPositiveInteger(columns) && value.column >= columns) {
    issues.push(`${path}.column is outside the spritesheet`);
  }
}

function validateSpritesheet(value: unknown, issues: string[]): UnknownRecord | null {
  if (!isRecord(value)) {
    issues.push("spritesheet must be an object");
    return null;
  }

  if (typeof value.src !== "string" || value.src.trim() === "") {
    issues.push("spritesheet.src must be a non-empty string");
  } else if (/^(?:https?:)?\/\//i.test(value.src)) {
    issues.push("spritesheet.src must be a bundled local asset path");
  }

  for (const key of [
    "width",
    "height",
    "columns",
    "rows",
    "frameWidth",
    "frameHeight",
  ] as const) {
    if (!isPositiveInteger(value[key])) {
      issues.push(`spritesheet.${key} must be a positive integer`);
    }
  }

  if (
    isPositiveInteger(value.width) &&
    isPositiveInteger(value.columns) &&
    isPositiveInteger(value.frameWidth) &&
    value.width !== value.columns * value.frameWidth
  ) {
    issues.push("spritesheet.width must equal columns * frameWidth");
  }
  if (
    isPositiveInteger(value.height) &&
    isPositiveInteger(value.rows) &&
    isPositiveInteger(value.frameHeight) &&
    value.height !== value.rows * value.frameHeight
  ) {
    issues.push("spritesheet.height must equal rows * frameHeight");
  }

  return value;
}

function validateAnimations(
  value: unknown,
  sheet: UnknownRecord | null,
  issues: string[],
): void {
  if (!isRecord(value)) {
    issues.push("animations must be an object");
    return;
  }

  for (const id of BASE_ANIMATION_IDS) {
    const animation = value[id];
    const path = `animations.${id}`;
    if (!isRecord(animation)) {
      issues.push(`${path} must be an object`);
      continue;
    }

    const rows = sheet?.rows;
    if (!isNonNegativeInteger(animation.row)) {
      issues.push(`${path}.row must be a non-negative integer`);
    } else if (isPositiveInteger(rows) && animation.row >= rows) {
      issues.push(`${path}.row is outside the spritesheet`);
    }
    if (typeof animation.loop !== "boolean") {
      issues.push(`${path}.loop must be a boolean`);
    }
    if (!Array.isArray(animation.frames) || animation.frames.length === 0) {
      issues.push(`${path}.frames must be a non-empty array`);
      continue;
    }

    const usedColumns = new Set<number>();
    animation.frames.forEach((frame, frameIndex) => {
      const framePath = `${path}.frames[${frameIndex}]`;
      if (!isRecord(frame)) {
        issues.push(`${framePath} must be an object`);
        return;
      }
      const columns = sheet?.columns;
      if (!isNonNegativeInteger(frame.column)) {
        issues.push(`${framePath}.column must be a non-negative integer`);
      } else {
        if (isPositiveInteger(columns) && frame.column >= columns) {
          issues.push(`${framePath}.column is outside the spritesheet`);
        }
        if (usedColumns.has(frame.column)) {
          issues.push(`${framePath}.column is duplicated within the animation`);
        }
        usedColumns.add(frame.column);
      }
      if (!isPositiveInteger(frame.durationMs)) {
        issues.push(`${framePath}.durationMs must be a positive integer`);
      }
    });
  }
}

export function validatePetManifest(value: unknown): readonly string[] {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return ["manifest root must be an object"];
  }

  if (value.schemaVersion !== 1) {
    issues.push("schemaVersion must be 1");
  }
  for (const key of ["id", "displayName", "description"] as const) {
    if (typeof value[key] !== "string" || value[key].trim() === "") {
      issues.push(`${key} must be a non-empty string`);
    }
  }

  const sheet = validateSpritesheet(value.spritesheet, issues);
  validateFrameReference(value.neutralFrame, "neutralFrame", sheet, issues);
  validateAnimations(value.animations, sheet, issues);
  return issues;
}

export function parsePetManifest(value: unknown): PetManifest {
  const issues = validatePetManifest(value);
  if (issues.length > 0) {
    throw new ManifestValidationError(issues);
  }
  return value as PetManifest;
}

export function parsePetManifestJson(json: string): PetManifest {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ManifestValidationError([`manifest is not valid JSON: ${message}`]);
  }
  return parsePetManifest(value);
}

export interface ManifestResponse {
  readonly ok: boolean;
  readonly status?: number;
  json(): Promise<unknown>;
}

export type ManifestFetcher = (url: string) => Promise<ManifestResponse>;

export async function loadPetManifest(
  url = "/data/pet.manifest.json",
  fetcher: ManifestFetcher = (path) => fetch(path),
): Promise<PetManifest> {
  const response = await fetcher(url);
  if (!response.ok) {
    const status = response.status === undefined ? "unknown" : response.status;
    throw new Error(`Unable to load pet manifest (${status})`);
  }
  return parsePetManifest(await response.json());
}

export function atlasFrameRect(
  manifest: PetManifest,
  frame: AtlasFrameReference,
): PixelRect {
  const { frameWidth, frameHeight } = manifest.spritesheet;
  return {
    x: frame.column * frameWidth,
    y: frame.row * frameHeight,
    width: frameWidth,
    height: frameHeight,
  };
}

export function animationFrameRect(
  manifest: PetManifest,
  animationId: BaseAnimationId,
  frameIndex: number,
): PixelRect {
  const animation = manifest.animations[animationId];
  const frame = animation.frames[frameIndex];
  if (frame === undefined) {
    throw new RangeError(`Frame ${frameIndex} does not exist in ${animationId}`);
  }
  return atlasFrameRect(manifest, { row: animation.row, column: frame.column });
}

export function animationDurationMs(
  manifest: PetManifest,
  animationId: BaseAnimationId,
): number {
  return manifest.animations[animationId].frames.reduce(
    (total, frame) => total + frame.durationMs,
    0,
  );
}
