import { fileURLToPath } from "node:url";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.name !== "b-branch-strategic-control-plane") failures.push("package identity is not B-Branch");
if (!String(packageJson.main || "").includes("dist/index.js")) failures.push("canonical package entrypoint is not dist/index.js");

const srcFiles = (await walk(path.join(root, "src"))).filter((f) => f.endsWith(".ts"));
for (const file of srcFiles) {
  const rel = path.relative(root, file).replaceAll(path.sep, "/");
  const text = await readFile(file, "utf8");
  if (/src\/b13\//i.test(rel)) failures.push(`B13 is outside canonical B00-B12: ${rel}`);
  if (!rel.startsWith("src/b08/") && /from\s+["'][^"']*external\/(?:adapter|runtime)\.js/.test(text)) failures.push(`direct external provider dependency outside B08: ${rel}`);
  if (/src\/m(?:0[1-9]|10)\//i.test(rel)) failures.push(`legacy execution module present: ${rel}`);
  if (/from\s+["'][^"']*\/m(?:0[1-9]|10)(?:\/|["'])/i.test(text)) failures.push(`legacy execution import in ${rel}`);
  if (/function\s+simpleHash\b|const\s+simpleHash\b|let\s+simpleHash\b/.test(text)) failures.push(`weak/canonical-confusing simpleHash implementation in ${rel}`);
  if (/charCodeAt\([^)]*\).*hash|hash.*charCodeAt\(/s.test(text)) failures.push(`non-cryptographic hash implementation in ${rel}`);
  if (/satisfied\s*:\s*true/.test(text) && rel.includes("/b02/")) failures.push(`B02 hard-coded satisfied=true in ${rel}`);
  if (/timezone_adapted\s*:\s*true/.test(text) && rel.includes("/b06/")) failures.push(`B06 claims timezone adaptation without proof in ${rel}`);
  if (/status\s*:\s*[^,;\n]*hash/i.test(text) && rel.includes("/b11/")) failures.push(`B11 status appears hash-derived in ${rel}`);
}

if (failures.length) {
  console.error("B-Branch release policy check FAILED");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`B-Branch release policy check PASS (${srcFiles.length} TypeScript source files scanned)`);
