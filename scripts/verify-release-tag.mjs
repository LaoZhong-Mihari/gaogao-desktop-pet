import { readFile } from "node:fs/promises";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;

if (!tag) {
  console.error("Usage: node scripts/verify-release-tag.mjs <v-tag>");
  process.exit(2);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const tauriConfig = JSON.parse(
  await readFile("src-tauri/tauri.conf.json", "utf8"),
);

const packageVersion = packageJson.version;
const tauriVersion = tauriConfig.version;

if (typeof packageVersion !== "string" || typeof tauriVersion !== "string") {
  console.error("package.json and tauri.conf.json must contain string versions.");
  process.exit(1);
}

if (packageVersion !== tauriVersion) {
  console.error(
    `Version mismatch: package.json=${packageVersion}, tauri.conf.json=${tauriVersion}`,
  );
  process.exit(1);
}

const expectedPrefix = `v${packageVersion}`;
if (tag !== expectedPrefix && !tag.startsWith(`${expectedPrefix}-`)) {
  console.error(
    `Tag ${tag} does not match application version ${packageVersion}. ` +
      `Expected ${expectedPrefix} or ${expectedPrefix}-<prerelease>.`,
  );
  process.exit(1);
}

console.log(`Release tag ${tag} matches application version ${packageVersion}.`);
