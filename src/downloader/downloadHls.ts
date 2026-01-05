// src/downloader/downloadHls.ts
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

export async function downloadHls(
  hlsUrl: string,
  outputPath: string,
  label: string
): Promise<void> {
  // Spawn ffmpeg and let it handle the HLS fetch and remux
  return new Promise((resolve, reject) => {
    // Build a minimal ffmpeg command for resilient streaming capture
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel", "error",

      // 🔁 resiliency
      "-fflags", "+discardcorrupt",
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5",

      "-i", hlsUrl,
      "-c", "copy",
      "-bsf:a", "aac_adtstoasc",
      outputPath,
    ]);

    // Resolve when ffmpeg finishes and bubble up non zero exits
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}
