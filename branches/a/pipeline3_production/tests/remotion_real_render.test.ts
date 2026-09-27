import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import path from "path";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

describe("Remotion Real Render — Frame-Range Shard Validation", () => {
  let outputDir: string;
  let serveUrl: string;

  beforeAll(async () => {
    outputDir = path.join("/tmp", `remotion_real_${Date.now()}`);
    await fs.mkdir(outputDir, { recursive: true });

    // Bundle the actual P3 composition
    const remotionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "remotion");
    const entryPoint = path.join(remotionDir, "index.tsx");
    
    console.log(`Bundling from ${entryPoint}...`);
    serveUrl = await bundle({
      entryPoint,
      concurrency: 1,
    });
    console.log(`✅ Bundle ready at ${serveUrl}`);
  }, 120000);

  afterAll(async () => {
    try {
      await fs.rm(outputDir, { recursive: true });
    } catch (e) {
      // ignore
    }
  });

  it("renders a minimal shard (10 frames, empty timeline)", async () => {
    const outputPath = path.join(outputDir, "shard_minimal.mp4");

    // Minimal timeline: just 10 frames, no entries (pure black background)
    const inputProps = {
      timeline: {
        fps: 30,
        total_frames: 10,
        entries: [],
      },
      assetPaths: {},
    };

    const composition = await selectComposition({
      serveUrl,
      id: "P3Timeline",  // FIXED: correct composition ID
      inputProps,
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outputPath,
      inputProps,
    });

    const stat = await fs.stat(outputPath);
    expect(stat.size).toBeGreaterThan(0);
    console.log(`✅ Shard rendered: ${outputPath} (${stat.size} bytes)`);

    // Verify with ffprobe
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,duration",
      "-of", "csv=p=0",
      outputPath,
    ]);

    const [codec, duration] = stdout.trim().split(",");
    expect(codec).toBe("h264");
    expect(parseFloat(duration)).toBeCloseTo(10 / 30, 1); // 10 frames @ 30fps = 0.33s
  }, 120000);

  it("renders a second shard (10 frames) for merge testing", async () => {
    const outputPath = path.join(outputDir, "shard_second.mp4");

    const inputProps = {
      timeline: {
        fps: 30,
        total_frames: 10,
        entries: [],
      },
      assetPaths: {},
    };

    const composition = await selectComposition({
      serveUrl,
      id: "P3Timeline",  // FIXED
      inputProps,
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: outputPath,
      inputProps,
    });

    const stat = await fs.stat(outputPath);
    expect(stat.size).toBeGreaterThan(0);
    console.log(`✅ Second shard rendered: ${stat.size} bytes`);
  }, 120000);

  it("merges two real Remotion shards via FFmpeg (validates compatibility)", async () => {
    const shard1 = path.join(outputDir, "shard_minimal.mp4");
    const shard2 = path.join(outputDir, "shard_second.mp4");
    const merged = path.join(outputDir, "merged.mp4");

    // Verify shards exist
    await fs.stat(shard1);
    await fs.stat(shard2);

    // Create concat list
    const concatList = path.join(outputDir, "concat.txt");
    await fs.writeFile(concatList, `file '${shard1}'\nfile '${shard2}'\n`);

    // Merge via FFmpeg
    await execFileAsync("ffmpeg", [
      "-f", "concat",
      "-safe", "0",
      "-i", concatList,
      "-c", "copy",
      merged,
    ]);

    const stat = await fs.stat(merged);
    expect(stat.size).toBeGreaterThan(0);

    // Verify merged output
    const { stdout: probeOut } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=duration",
      "-of", "csv=p=0",
      merged,
    ]);

    const duration = parseFloat(probeOut.trim());
    expect(duration).toBeCloseTo(20 / 30, 0); // 20 frames @ 30fps
    console.log(`✅ Merged shard: ${stat.size} bytes, ${duration.toFixed(2)}s`);
  }, 120000);
});
