#!/usr/bin/env node
// Runs every suite of the unified repository and writes one honest summary.
// B-Branch's 10 pre-existing legacy failures are reported separately and
// compared by NAME against verification/known-failures.json: any new failure,
// and any silently "fixed" one, fails the gate.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const WIN = process.platform === "win32";
const TIMEOUT = 20 * 60_000;
const out = join(root, "verification", "current");
mkdirSync(out, { recursive: true });
const policy = JSON.parse(readFileSync(join(root, "verification/known-failures.json"), "utf8"));
const known = policy["b-branch"];
// Only these tests may be skipped (opt-in live network tests). Any other skip —
// e.g. "ffmpeg missing" or "sqlite3 missing" — fails the gate instead of passing quietly.
const allowedSkips = policy["allowed-skips"] ?? [];

function vitest(dir, name, env = {}) {
  const cwd = join(root, dir);
  const report = join(out, `${name}.vitest.json`);
  rmSync(report, { force: true }); // never read a stale report
  // relative path: no spaces reach the shell on Windows
  const res = spawnSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${relative(cwd, report).replace(/\\/g, "/")}`], { cwd, stdio: "ignore", shell: WIN, timeout: TIMEOUT, env: { ...process.env, ...env } });
  if (!existsSync(report)) {
    return { suite: name, passed: 0, failed: 1, skipped: 0, total: 0, failures: [`vitest produced no report (exit ${res.status ?? res.signal ?? res.error?.code}) — crash, timeout or missing dependencies`] };
  }
  const r = JSON.parse(readFileSync(report, "utf8"));
  const failed = [];
  const skippedNames = [];
  for (const file of r.testResults) {
    const rel = file.name.replace(/\\/g, "/").replace(/.*\/tests\//, "tests/");
    // a test file that failed to load has no assertions but still counts
    if (file.status === "failed" && file.assertionResults.length === 0) failed.push(`${rel} :: FILE FAILED TO LOAD: ${(file.message ?? "").split("\n")[0]}`);
    for (const a of file.assertionResults) {
      if (a.status === "failed") failed.push(`${rel} :: ${a.fullName}`);
      else if (a.status === "skipped" || a.status === "pending" || a.status === "todo") skippedNames.push(`${rel} :: ${a.fullName}`);
    }
  }
  const unexpectedSkips = skippedNames.filter((n) => !allowedSkips.includes(n));
  for (const n of unexpectedSkips) failed.push(`UNEXPECTED SKIP (missing tool?): ${n}`);
  if (res.status !== 0 && failed.length === 0) failed.push(`vitest exited ${res.status} without reporting a failing test`);
  return { suite: name, passed: r.numPassedTests, failed: failed.length, skipped: skippedNames.length - unexpectedSkips.length, total: r.numTotalTests, failures: failed };
}
function nodeScript(dir, script, name, re) {
  const res = spawnSync("node", [script], { cwd: join(root, dir), encoding: "utf8", timeout: TIMEOUT });
  writeFileSync(join(out, `${name}.log`), (res.stdout ?? "") + (res.stderr ?? ""));
  const m = re.exec(res.stdout ?? "") ?? [];
  const passed = Number(m[1] ?? 0), total = Number(m[2] ?? 0);
  // a non-zero exit is a failure even if the pass line printed
  const failed = Math.max(total - passed, res.status === 0 ? 0 : 1);
  return { suite: name, passed, failed, total, failures: res.status === 0 ? [] : [`exit ${res.status ?? res.signal} — see verification/current/${name}.log`] };
}

const results = [
  vitest("branches/a/pipeline1_research", "a-p1-research"),
  vitest("branches/a/pipeline2_creative", "a-p2-creative"),
  vitest("branches/a/pipeline3_production", "a-p3-production"),
  vitest("branches/b", "b-strategy"),
  (() => { const r = nodeScript("apps/youtube-agent", "test.js", "youtube-agent", /Passed: (\d+)[\s\S]*Total: (\d+)/); return r; })(),
  nodeScript("apps/youtube-agent", "integration/test-integration.js", "youtube-agent-unified", /(\d+)\/(\d+) unified integration tests passed/),
  // includes one REAL Remotion 9:16 render through the P3 stage runner (checks the finished frames too)
  vitest("integration/bridges", "unified-bridges", { UNIFIED_REAL_RENDER: process.env.UNIFIED_REAL_RENDER ?? "1" }),
];

// --render-optional (used by `npm run kur`): if the ONLY failure is the real Remotion render
// (Chrome download blocked, missing libnss3/libgbm …) report it as a warning, not a failed install.
const RENDER_OPTIONAL = process.argv.includes("--render-optional");
const isRealRender = (f) => /REAL Remotion render|remotion_real_render|Remotion Real Render/.test(f);
let renderWarning = null;
let ok = true;
const lines = [];
for (const r of results) {
  if (r.suite === "b-strategy") {
    const unexpected = r.failures.filter((f) => !known.includes(f)); // incl. load failures and unexpected skips
    const vanished = known.filter((k) => !r.failures.includes(k));
    const status = unexpected.length === 0 && vanished.length === 0 ? "KNOWN_RED (unchanged pre-existing legacy failures)" : "REGRESSION";
    if (status === "REGRESSION") ok = false;
    lines.push(`${r.suite}: ${r.passed}/${r.total} passed, ${r.failed} failed — ${status}`);
    for (const f of unexpected) lines.push(`   NEW FAILURE: ${f}`);
    for (const f of vanished) lines.push(`   KNOWN FAILURE NO LONGER FAILS (update known-failures.json deliberately): ${f}`);
  } else {
    if (RENDER_OPTIONAL && r.failures.length > 0 && r.failures.every(isRealRender)) {
      renderWarning = [renderWarning, `${r.suite}: ${r.failures.length} render testi`].filter(Boolean).join("; ");
      r.failed = 0;
      r.failures = [];
    }
    if (r.failed > 0 || r.total === 0) ok = false;
    lines.push(`${r.suite}: ${r.passed}/${r.total - (r.skipped ?? 0)} passed${r.skipped ? ` (+${r.skipped} opt-in live test skipped)` : ""}${r.failed ? `, ${r.failed} FAILED` : ""}`);
    for (const f of r.failures) lines.push(`   ${f}`);
  }
}
if (renderWarning) lines.push(`WARNING: gerçek Remotion render çalışmadı (${renderWarning}). Hattın geri kalanı doğrulandı; render için Chrome indirmesine izin verin / Linux'ta libnss3 libgbm1 libasound2 kurun, sonra: npm run verify`);
const summary = { verified_at: new Date().toISOString(), overall: ok ? (renderWarning ? "PASS (render WARNING)" : "PASS (with documented B legacy KNOWN_RED)") : "FAIL", render_warning: renderWarning, suites: results };
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2));
console.log(lines.join("\n"));
console.log(`\nOVERALL: ${summary.overall}`);
process.exit(ok ? 0 : 1);
