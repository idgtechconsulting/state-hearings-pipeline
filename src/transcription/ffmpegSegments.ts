import fs from "fs";
import path from "path";
import { spawn } from "child_process";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // Spawn the command and capture stderr for errors
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    // Accumulate stderr for better failure context
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} ${args.join(" ")} failed (code ${code}): ${stderr}`));
    });
  });
}

// Extract segmented MP3 audio optimized for speech and API limits
export async function extractAudioSegments(
  videoPath: string,
  outDir: string,
  segmentSeconds = 600
): Promise<string[]> {
  // Ensure output directory exists
  fs.mkdirSync(outDir, { recursive: true });

  // Build a deterministic filename pattern for ffmpeg
  const pattern = path.join(outDir, "segment_%05d.mp3");

  // Run ffmpeg with mono 16kHz speech settings and timed segments
  await run("ffmpeg", [
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "48k",
    "-f",
    "segment",
    "-segment_time",
    String(segmentSeconds),
    "-reset_timestamps",
    "1",
    pattern,
  ]);

  // Collect generated segments in order
  const segments = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith("segment_") && f.endsWith(".mp3"))
    .sort()
    .map((f) => path.join(outDir, f));

  // Fail fast if nothing was produced
  if (segments.length === 0) {
    throw new Error(`No audio segments created for ${videoPath}`);
  }

  return segments;
}

export function safeRmDir(dir: string) {
  try {
    // Best effort cleanup for temp directories
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
