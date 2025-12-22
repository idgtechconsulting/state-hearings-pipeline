import fs from "fs";
import path from "path";
import { spawn } from "child_process";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} ${args.join(" ")} failed (code ${code}): ${stderr}`));
    });
  });
}

/**
 * Extracts segmented MP3 audio from a video.
 * Tuned for speech + small size (avoid 25MB API limit):
 * - mono, 16kHz, 48k bitrate
 * - 10 minute segments by default
 */
export async function extractAudioSegments(
  videoPath: string,
  outDir: string,
  segmentSeconds = 600
): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });

  const pattern = path.join(outDir, "segment_%05d.mp3");

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

  const segments = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith("segment_") && f.endsWith(".mp3"))
    .sort()
    .map((f) => path.join(outDir, f));

  if (segments.length === 0) {
    throw new Error(`No audio segments created for ${videoPath}`);
  }

  return segments;
}

export function safeRmDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}
