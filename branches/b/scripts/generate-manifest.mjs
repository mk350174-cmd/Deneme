import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const excludedTop = new Set(["node_modules", "dist", ".git"]);
const excludedFiles = new Set(["manifest.json"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (dir === root && excludedTop.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full));
    else if (!excludedFiles.has(path.relative(root, full).replaceAll(path.sep, "/"))) out.push(full);
  }
  return out;
}

const files = (await walk(root)).sort();
const records = [];
for (const file of files) {
  const bytes = await readFile(file);
  const rel = path.relative(root, file).replaceAll(path.sep, "/");
  const s = await stat(file);
  records.push({ path: rel, size: s.size, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const pkg = JSON.parse(await readFile(path.join(root,"package.json"),"utf8"));
const manifestCore = {
  schema: "b-branch-release-manifest/v1",
  release_id: "B_BRANCH_V5_FINAL_WITH_AGENT_REACH_20260906",
  package_version: pkg.version,
  scope: "B00-B12 only; legacy SOP/M01-M10 excluded",
  hash_algorithm: "SHA-256",
  file_count: records.length,
  files: records,
};
const manifestHash = createHash("sha256").update(JSON.stringify(manifestCore)).digest("hex");
const manifest = { ...manifestCore, manifest_content_hash: manifestHash };
await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest generated: ${records.length} files; content hash ${manifestHash}`);
