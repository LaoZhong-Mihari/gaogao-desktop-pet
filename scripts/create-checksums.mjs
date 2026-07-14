import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const inputDirectory = resolve(process.argv[2] ?? "release-assets");
const outputPath = resolve(process.argv[3] ?? "SHA256SUMS.txt");
const outputName = basename(outputPath);

const entries = (await readdir(inputDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .filter((entry) => entry.name !== outputName)
  .sort((left, right) => left.name.localeCompare(right.name, "en"));

if (entries.length === 0) {
  console.error(`No release assets found in ${inputDirectory}.`);
  process.exit(1);
}

function sha256(filePath) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

const lines = [];
for (const entry of entries) {
  const digest = await sha256(join(inputDirectory, entry.name));
  lines.push(`${digest}  ${basename(entry.name)}`);
}

await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${entries.length} checksums to ${outputPath}.`);
