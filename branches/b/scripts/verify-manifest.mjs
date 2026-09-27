import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const pkg=JSON.parse(await readFile(path.join(root,"package.json"),"utf8"));
if(manifest.package_version!==pkg.version) throw new Error("manifest package version mismatch");
if (manifest.hash_algorithm !== "SHA-256") throw new Error("manifest does not use SHA-256");
const { manifest_content_hash, ...core } = manifest;
const actualManifestHash = createHash("sha256").update(JSON.stringify(core)).digest("hex");
if (manifest_content_hash !== actualManifestHash) throw new Error("manifest content hash mismatch");

const excludedTop = new Set(["node_modules", "dist", ".git"]);
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (dir === root && excludedTop.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full));
    else {
      const rel = path.relative(root, full).replaceAll(path.sep, "/");
      if (rel !== "manifest.json") out.push(full);
    }
  }
  return out;
}

const actualFiles = (await walk(root)).sort();
const expectedPaths = new Set(manifest.files.map((r) => r.path));
const actualPaths = new Set(actualFiles.map((f) => path.relative(root, f).replaceAll(path.sep, "/")));
for (const p of expectedPaths) if (!actualPaths.has(p)) throw new Error(`missing manifested file: ${p}`);
for (const p of actualPaths) if (!expectedPaths.has(p)) throw new Error(`unexpected unmanifested file: ${p}`);
if (manifest.file_count !== manifest.files.length || manifest.file_count !== actualFiles.length) throw new Error("file_count mismatch");
for (const record of manifest.files) {
  const file = path.join(root, record.path);
  const bytes = await readFile(file);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const s = await stat(file);
  if (digest !== record.sha256) throw new Error(`SHA-256 mismatch: ${record.path}`);
  if (s.size !== record.size) throw new Error(`size mismatch: ${record.path}`);
}
console.log(`manifest verification PASS (${actualFiles.length} files, SHA-256)`);
