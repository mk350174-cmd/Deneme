// P3.08-DIST — Distributed Render: Worker Distribution & Kaggle Kernel Execution
// Manages notebook job submission to Kaggle, parameter embedding, output
// retrieval. NOT phase P3.09 (Automated QA, qa.ts) — see the naming note in
// orchestration_p309.ts.

import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { ShardAssignment, ShardRenderOutput } from "./types.js";
import { sha256Buffer } from "./ids.js";
import { defaultFfprobeMediaProbe } from "./assetValidation.js";
import type { MediaProbe } from "./assetValidation.js";
import { redactSecrets } from "./secretGuard.js";

const execFileAsync = promisify(execFile);

// Kaggle kernel execution seam — one real implementation (defaultExecKaggleCli)
export type ExecKaggleCli = (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr?: string }>;

export const defaultExecKaggleCli: ExecKaggleCli = async (args) => {
  try {
    const { stdout } = await execFileAsync("kaggle", args);
    return { exitCode: 0, stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr };
  }
};

// Kaggle kernel parameter embedding strategy
// Since Kaggle CLI doesn't support --set-notebook-param, we embed shard config
// in the kernel's metadata.json or as environment variables in the notebook source.
export interface KernelParameterBundle {
  shard_id: string;
  frame_range: { start: number; end: number };
  timeline_json: string;
  // TIER-1 REPAIR T1.8/T1.9 additions. Optional so a caller who has not yet
  // adopted the render-bundle path does not break the type; the generated
  // kernel script uses them when present and falls back to the previous
  // (unpinned, timeline-blind) behavior only if they are genuinely absent —
  // which submitKaggleShard now refuses at submission time (see below).
  asset_manifest?: Array<{ asset_requirement_id: string; asset_file_id: string; content_hash: string; media_type?: string }>;
  render_config?: { resolution: string; codec: string; fps: number };
  code_version?: { kind: "git_commit" | "release_digest"; value: string; repo_url?: string };
  bundle_hash?: string;
  asset_file_ids: string[];
  output_dataset_id: string;
}

// Build kernel metadata for submission
export function buildKernelMetadata(kernelSlug: string, title: string): Record<string, unknown> {
  const [username, kernelName] = kernelSlug.split("/");
  return {
    id: `${username}/${kernelName}`,
    title,
    code_file: "render_shard.py",
    language: "python",
    kernel_type: "notebook",
    is_private: true,
    enable_gpu: false,
    // render_shard.py clones the repository from GitHub and runs `npm
    // install` — both require network access. enable_internet must be true
    // or the kernel fails at step [1/5]/[2/5] on every real Kaggle run.
    enable_internet: true,
    dataset_sources: [],
    competition_sources: [],
    kernel_sources: [],
  };
}

// Submit a shard render job to Kaggle
export async function submitKaggleShard(
  params: {
    assignment: ShardAssignment;
    kernelSlug: string;
    outputDatasetId: string;
    workingDir: string;
    parameterBundle: KernelParameterBundle;
    // Repository the Kaggle kernel clones to get the render code. No default
    // — caller resolves this via p309Config.loadP309Identity() so no
    // deployer's personal fork is hardcoded into this module.
    repoUrl: string;
  },
  execKaggle: ExecKaggleCli = defaultExecKaggleCli,
): Promise<{ kernel_id: string; submitted_at: string }> {
  // TIER-1 REPAIR T1.8/T1.9 — hard-fail rather than submit a kernel with no
  // real timeline or no pinned code. Previously
  // `timeline_json: JSON.stringify({})` and an unpinned `git pull` reached
  // this point silently; both are now refused at the submission boundary,
  // which is the last place in-process that can still stop it.
  if (params.parameterBundle.timeline_json === "{}") {
    throw new Error(
      "submitKaggleShard refused: timeline_json is an empty object. The distributed render must " +
        "consume the same approved canonical timeline as the local render path (T1.8).",
    );
  }
  if (!params.parameterBundle.code_version) {
    throw new Error(
      "submitKaggleShard refused: no pinned code_version was supplied. A distributed render must " +
        "not resolve arbitrary moving repository state (T1.9).",
    );
  }

  // Create kernel folder with metadata + embedded parameters
  const kernelDir = path.join(params.workingDir, `kernel_${params.assignment.shard_id}`);
  await fs.mkdir(kernelDir, { recursive: true });

  // Write metadata.json
  // Title must be slug-compatible (lowercase, dashes, no underscores) to match Kaggle's URL slug algorithm
  const kernelName = params.kernelSlug.split("/")[1];
  const metadata = buildKernelMetadata(params.kernelSlug, kernelName || `P3.08-DIST Shard Render ${params.assignment.shard_id}`);
  await fs.writeFile(path.join(kernelDir, "kernel-metadata.json"), JSON.stringify(metadata, null, 2));

  // Write render_shard.py with real Remotion frame-range rendering
  const pythonCode = `
# P3.08-DIST Shard Render Kernel — Real Remotion frame-range rendering
import json
import os
import subprocess
import sys
from pathlib import Path
from datetime import datetime

shard_config = ${JSON.stringify(params.parameterBundle)}
shard_id = shard_config['shard_id']
frame_range = shard_config['frame_range']
start_frame = frame_range['start']
end_frame = frame_range['end']

print("=" * 60)
print(f"[P3.08-DIST SHARD RENDER] {shard_id}")
print(f"Frame range: {start_frame}-{end_frame}")
print("=" * 60)

# Setup
working_dir = Path("/kaggle/working")
output_dir = working_dir / "shard_outputs"
output_dir.mkdir(exist_ok=True)
shard_output = output_dir / f"shard_{shard_id}.mp4"

# TIER-1 REPAIR T1.9 — checkout the EXACT pinned commit, never a moving
# branch/HEAD. Previously this step ran \`git pull\` on an existing clone,
# so an approved package could be rendered by code that postdated its
# approval. code_version is required by submitKaggleShard before this
# script is ever generated (see the guard above), so it is always present
# here.
code_version = shard_config.get('code_version')
pinned_sha = code_version['value'] if code_version else None
repo_dir = working_dir / "youtube_repo"
if not repo_dir.exists():
    print("[1/5] Cloning repository...")
    subprocess.run([
        "git", "clone",
        ${JSON.stringify(params.repoUrl)},
        str(repo_dir)
    ], check=True)
else:
    print("[1/5] Repository already present.")

if pinned_sha and code_version.get('kind') == 'git_commit':
    print(f"[1/5] Checking out pinned commit {pinned_sha} (never HEAD/branch/tag)...")
    subprocess.run(["git", "-C", str(repo_dir), "fetch", "--depth", "1", "origin", pinned_sha], check=False)
    subprocess.run(["git", "-C", str(repo_dir), "checkout", "--detach", pinned_sha], check=True)
else:
    print("[1/5] WARNING: no pinned git_commit code_version supplied; repository state is unpinned.")

# Install Remotion dependencies
print("[2/5] Installing Remotion dependencies...")
p3_dir = repo_dir / "pipeline3_production"
subprocess.run(["npm", "install"], cwd=str(p3_dir), check=True)

# Verify Remotion CLI
print("[3/5] Verifying Remotion CLI...")
result = subprocess.run(["npx", "remotion", "--version"], capture_output=True, text=True, cwd=str(p3_dir), check=True)
print(f"  Remotion: {result.stdout.strip()}")

# TIER-1 REPAIR T1.8 — pass the REAL approved timeline + asset manifest +
# render configuration as Remotion input props, the same way the local
# render path does (render.ts's defaultExecRemotionRender). Previously this
# invocation carried NO --props at all, so whatever the composition's own
# defaults were is what got rendered — never the approved timeline.
timeline_json = shard_config.get('timeline_json', '{}')
asset_manifest = shard_config.get('asset_manifest', [])
render_config = shard_config.get('render_config') or {"resolution": "1080x1920", "codec": "h264", "fps": 30}
props_path = output_dir / f"shard_{shard_id}_props.json"
props_path.write_text(json.dumps({
    "timeline": json.loads(timeline_json),
    "assetPaths": {a["asset_file_id"]: {"path": a["asset_file_id"], "is_video": a.get("media_type") == "video"} for a in asset_manifest},
}))

print(f"[4/5] Rendering shard {shard_id} (frames {start_frame}-{end_frame})...")
remotion_cmd = [
    "npx", "remotion", "render",
    "remotion/index.tsx",
    "P3Timeline",
    str(shard_output),
    "--frame-range", f"{start_frame}-{end_frame}",
    "--codec", render_config.get("codec", "h264"),
    "--props", str(props_path),
]
result = subprocess.run(remotion_cmd, cwd=str(p3_dir), capture_output=True, text=True)

if result.returncode != 0:
    print(f"  ❌ Render failed!")
    print(f"  STDOUT: {result.stdout}")
    print(f"  STDERR: {result.stderr}")
    sys.exit(1)

print(f"  ✅ Shard rendered: {shard_output}")

# Verify output
if not shard_output.exists():
    print(f"  ❌ Output file not created!")
    sys.exit(1)

size_mb = shard_output.stat().st_size / (1024 * 1024)
print(f"  Size: {size_mb:.2f} MB")

# Report results
print("[5/5] Generating report...")
report = {
    "shard_id": shard_id,
    "frame_range": {"start": start_frame, "end": end_frame},
    "output_path": str(shard_output),
    "size_bytes": shard_output.stat().st_size,
    "timestamp": datetime.now().isoformat(),
    "status": "SUCCESS"
}
report_path = output_dir / f"shard_{shard_id}_report.json"
report_path.write_text(json.dumps(report, indent=2))

print("\\n" + "=" * 60)
print(f"✅ SHARD RENDER COMPLETE")
print("=" * 60)
print(f"Output: {shard_output}")
print(f"Report: {report_path}")
`;

  await fs.writeFile(path.join(kernelDir, "render_shard.py"), pythonCode);

  // Submit via kaggle kernels push
  console.log(`[submitKaggleShard] Pushing kernel from: ${kernelDir}`);
  console.log(`[submitKaggleShard] Kernel slug: ${params.kernelSlug}`);

  const result = await execKaggle(["kernels", "push", "-p", kernelDir, "--timeout", "54000"]); // 15 hour timeout

  if (result.exitCode !== 0) {
    // AUDIT FIX (repair pass, DEF-09): Kaggle CLI stderr/stdout can embed
    // credential-shaped fragments (e.g. an echoed API key in a auth-failure
    // message); redact before it hits the console or an error message, same
    // pattern already used for ElevenLabs response bodies in elevenlabs.ts.
    console.error(`[submitKaggleShard] Kaggle CLI exit code: ${result.exitCode}`);
    console.error(`[submitKaggleShard] stderr: ${redactSecrets(result.stderr ?? "")}`);
    console.error(`[submitKaggleShard] stdout: ${redactSecrets(result.stdout)}`);
    throw new Error(`Kaggle kernel push failed (exit ${result.exitCode}): ${redactSecrets(result.stderr || result.stdout)}`);
  }

  console.log(`[submitKaggleShard] ✅ Kernel pushed successfully`);
  return {
    kernel_id: `${params.kernelSlug}@${params.assignment.shard_id}`,
    submitted_at: new Date().toISOString(),
  };
}

// TIER-3 REPAIR — structured Kaggle status parsing.
//
// PROBLEM: the previous parser lowercased the ENTIRE stdout and did a bare
// substring `.includes("running")` / `.includes("complete")` anywhere in
// it. Kaggle CLI output routinely includes the word "running" or "complete"
// inside unrelated log lines (a package install log, a prior line in a
// multi-kernel batch, etc.), which this could misread as the shard's status.
//
// REPAIR: first look for the CLI's own structured "status: <word>" field
// (what both the real `kaggle kernels status` output and this repo's own
// test fixtures emit), and classify from that word specifically. Only when
// no such field is present does this fall back to the old loose substring
// scan, for CLI output shapes this repo hasn't seen — never silently
// dropping a status the structured path would have caught.
const KAGGLE_STATUS_FIELD_RE = /status\s*:\s*([a-z_]+)/i;

function classifyKaggleStatusWord(word: string): "running" | "success" | "error" | undefined {
  const w = word.toLowerCase();
  if (w === "running" || w === "queued" || w === "pending") return "running";
  if (w === "complete" || w === "completed" || w === "success" || w === "succeeded") return "success";
  if (w === "error" || w === "failed" || w === "failure" || w === "cancelled" || w === "canceled") return "error";
  return undefined;
}

// Monitor shard render job status
export async function checkKaggleShard(
  params: { kernelSlug: string; shardId: string; workingDir: string },
  execKaggle: ExecKaggleCli = defaultExecKaggleCli,
): Promise<{ status: "running" | "success" | "error"; logs?: string }> {
  const result = await execKaggle(["kernels", "status", params.kernelSlug]);

  if (result.exitCode !== 0) {
    return { status: "error", logs: result.stderr || result.stdout };
  }

  const structuredMatch = result.stdout.match(KAGGLE_STATUS_FIELD_RE);
  if (structuredMatch) {
    const classified = classifyKaggleStatusWord(structuredMatch[1]!);
    if (classified) return { status: classified };
  }

  // Fallback: unstructured output from a CLI shape this hasn't seen. Loose
  // substring matching, same as before the repair, but only reached when
  // the structured field is genuinely absent.
  const output = result.stdout.toLowerCase();
  if (output.includes("running")) return { status: "running" };
  if (output.includes("complete") || output.includes("success")) return { status: "success" };
  return { status: "error", logs: result.stdout };
}

// Download shard output from Kaggle
export async function downloadKaggleShard(
  params: {
    kernelSlug: string;
    shardId: string;
    outputDir: string;
    // The shard's OWN assigned frame range (from ShardSpecification) — this
    // is assignment metadata, not something a probe can recover, so the
    // caller (which planned the shard) supplies it rather than a placeholder.
    frameRange: { start: number; end: number };
  },
  execKaggle: ExecKaggleCli = defaultExecKaggleCli,
  probe: MediaProbe = defaultFfprobeMediaProbe,
): Promise<ShardRenderOutput | null> {
  // Create output subdirectory
  const shardDir = path.join(params.outputDir, params.shardId);
  await fs.mkdir(shardDir, { recursive: true });

  // Download kernel output
  const result = await execKaggle(["kernels", "output", params.kernelSlug, "-p", shardDir]);

  if (result.exitCode !== 0) {
    return null; // output not available
  }

  // Find video file (shard_output.mp4 or similar)
  const files = await fs.readdir(shardDir);
  const videoFile = files.find((f) => f.endsWith(".mp4") || f.endsWith(".mov"));

  if (!videoFile) {
    return null; // no video output
  }

  const videoPath = path.join(shardDir, videoFile);
  const stat = await fs.stat(videoPath);
  const buffer = await fs.readFile(videoPath);
  const sha = sha256Buffer(buffer);

  // Real duration measured from the downloaded file itself (via ffprobe in
  // production; an injected fixture in tests) — not derived arithmetically
  // from the frame range, since a partial/corrupt Kaggle render could
  // legitimately produce fewer frames than planned and this should surface
  // that instead of masking it.
  const probeResult = await probe(videoPath);

  return {
    shard_id: params.shardId,
    frame_range: params.frameRange,
    video_file_path: videoPath,
    sha256: sha,
    bytes: stat.size,
    duration_s: probeResult.duration_s ?? 0,
  };
}
