#!/usr/bin/env node
// Installs every package from its OWN lockfile (no hoisting, no new root
// lockfile — each branch keeps the exact dependency set it was verified
// with), then builds the TypeScript packages the bridges import from.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const WIN = process.platform === "win32";
const steps = [
  ["branches/a/pipeline1_research", ["ci"], ["run", "build"]],
  ["branches/a/pipeline2_creative", ["ci"], ["run", "build"]],
  ["branches/a/pipeline3_production", ["ci"], ["run", "build"]],
  ["branches/b", ["ci"], ["run", "build"]],
  ["apps/youtube-agent", ["ci"], null],
  ["integration/bridges", ["ci"], ["run", "build"]],
];
for (const [dir, install, build] of steps) {
  const cwd = join(root, dir);
  console.log(`\n=== ${dir}`);
  execFileSync("npm", [...install, "--no-audit", "--no-fund"], { cwd, stdio: "inherit", shell: WIN });
  if (build) execFileSync("npm", build, { cwd, stdio: "inherit", shell: WIN });
}
// Local seal key (HMAC) for unified envelopes: created once, never overwritten, never committed.
const { ensureSealKey } = await import(new URL("../integration/bridges/dist/sealKey.js", import.meta.url).href);
console.log(`\nseal key: ${ensureSealKey()}`);
console.log("\nsetup complete — run `npm run verify` next");
