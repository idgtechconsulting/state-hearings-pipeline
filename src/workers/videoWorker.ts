// src/workers/videoWorker.ts
import { Worker, Job } from "bullmq";
import path from "path";
import fs from "fs";
import { downloadHls } from "../downloader/downloadHls";
import { downloadVideo } from "../downloader/downloadVideo";
import { saveVideo } from "../db/videoRepository";
import { logger } from "../utils/logger";
import { connection } from "../queue/videoQueue";
import { pipelineProgress } from "../utils/pipelineProgress";
import "../bootstrap";

import { transcriptionQueue } from "../queue/transcriptionQueue";
import { markTranscriptPending } from "../db/transcriptionRepository";
import type { HearingVideoMetadata } from "../types/video";

const VIDEO_DIR = path.resolve("data/videos");

function fileExists(file: string) {
  try {
    return fs.existsSync(file) && fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

function normalizeChamber(v: unknown): "house" | "senate" {
  const s = String(v).toLowerCase();
  if (s === "house" || s === "senate") return s;
  throw new Error(`Invalid chamber value: ${v}`);
}

function normalizePublishedAt(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (v instanceof Date) return v;

  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid publishedAt value: ${v}`);
  }
  return d;
}

/**
 * Some scraped ids include extensions (e.g. "HTRAN-121625.mp4").
 * Normalize to a stable base for filenames + job ids.
 */
function normalizeVideoIdBase(id: string): string {
  const clean = String(id).split("?")[0].split("#")[0];
  // remove repeated media extensions like .mp4.mp4 or .m3u8.m3u8
  return clean.replace(/(\.(mp4|m3u8))+$/i, "");
}

export const worker = new Worker(
  "video-downloads",
  async (job: Job) => {
    const raw = job.data as any;

    if (!raw?.id || !raw?.url || !raw?.title || !raw?.chamber) {
      throw new Error("Invalid job payload (missing id/url/title/chamber)");
    }

    const video: HearingVideoMetadata = {
      id: String(raw.id),
      title: String(raw.title),
      url: String(raw.url),
      chamber: normalizeChamber(raw.chamber),
      publishedAt: normalizePublishedAt(raw.publishedAt),
      duration:
        raw.duration === undefined || raw.duration === null
          ? raw.duration
          : Number(raw.duration),
    };

    // ✅ Fix ".mp4.mp4" by normalizing id
    const baseId = normalizeVideoIdBase(video.id);

    // ✅ stable local filename
    const localPath = path.join(VIDEO_DIR, `${video.chamber}-${baseId}.mp4`);
    const label = video.title;

    // If file exists, treat as previously successful download
    if (fileExists(localPath)) {
      logger.info(`[${label}] File already exists, skipping download`);

      await saveVideo({ ...video, localPath });

      await markTranscriptPending(video.id);

      // ✅ Pass localPath so transcriber can upload+delete
      await transcriptionQueue.add(
        "transcribe",
        { videoId: video.id, localPath },
        { jobId: video.id } // keep idempotency by original id
      );

      pipelineProgress.increment("download");
      return;
    }

    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

    try {
      if (video.url.endsWith(".m3u8")) {
        logger.info(`[${label}] Starting HLS download`);
        await downloadHls(video.url, localPath, label);
      } else {
        logger.info(`[${label}] Starting MP4 download`);
        await downloadVideo(video.url, localPath, label, {
          onProgress: async ({ downloadedBytes, totalBytes, bps }) => {
            // BullMQ progress can be any JSON-serializable value
            await job.updateProgress({
              stage: "download",
              videoId: video.id,
              title: label,
              downloadedBytes,
              totalBytes: totalBytes ?? null,
              bps: bps ?? null,
            });
          },
        });
      }

      await saveVideo({ ...video, localPath });

      await markTranscriptPending(video.id);

      // ✅ Pass localPath so transcriber can upload+delete
      await transcriptionQueue.add(
        "transcribe",
        { videoId: video.id, localPath },
        { jobId: video.id }
      );

      logger.info(`[DOWNLOAD] Enqueued transcription for ${video.id}`);

      pipelineProgress.increment("download");
    } catch (err: any) {
      // cleanup partial files
      try {
        if (fs.existsSync(localPath)) await fs.promises.rm(localPath, { force: true });
        if (fs.existsSync(`${localPath}.part`)) await fs.promises.rm(`${localPath}.part`, { force: true });

        // if you use a parallel parts directory anywhere
        if (fs.existsSync(`${localPath}.part.parts`)) {
          await fs.promises.rm(`${localPath}.part.parts`, { recursive: true, force: true });
        }
      } catch {}

      logger.error(
        { videoId: video.id, url: video.url, err: err?.message || err, stack: err?.stack },
        `[DOWNLOAD FAILED] ${label}`
      );

      throw err;
    }
  },
  {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY || 3),
  }
);
