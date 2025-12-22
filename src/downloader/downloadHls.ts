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
  return new Promise((resolve, reject) => {
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

    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}`));
    });
  });
}

