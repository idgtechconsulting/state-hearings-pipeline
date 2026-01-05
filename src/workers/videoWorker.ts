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
import { prisma } from "../db/client";

// Base directory for stored video files
const VIDEO_DIR = path.resolve("data/videos");

function fileExists(file: string) {
  try {
    // Check that the file exists and is non empty
    return fs.existsSync(file) && fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

function normalizeChamber(v: unknown): "house" | "senate" {
  // Coerce to a supported chamber label
  const s = String(v).toLowerCase();
  if (s === "house" || s === "senate") return s;
  throw new Error(`Invalid chamber value: ${v}`);
}

function normalizePublishedAt(v: unknown): Date | null | undefined {
  // Preserve undefined and null when provided
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (v instanceof Date) return v;

  // Parse string input and validate
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid publishedAt value: ${v}`);
  }
  return d;
}

// Normalize scraped ids to stable bases for filenames and job ids
function normalizeVideoIdBase(id: string): string {
  const clean = String(id).split("?")[0].split("#")[0];
  // Remove repeated media extensions like mp4 or m3u8
  return clean.replace(/(\.(mp4|m3u8))+$/i, "");
}

export const worker = new Worker(
  "video-downloads",
  async (job: Job) => {
    // Validate incoming job payload
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

    // Normalize id to avoid double extensions
    const baseId = normalizeVideoIdBase(video.id);

    // Build a stable local filename
    const localPath = path.join(VIDEO_DIR, `${video.chamber}-${baseId}.mp4`);
    const label = video.title;

    // Mark download as pending in DB
    await prisma.hearingVideo.upsert({
      where: { id: video.id },
      create: {
        id: video.id,
        chamber: video.chamber,
        title: video.title,
        sourceUrl: video.url,
        localPath: null,
        publishedAt: video.publishedAt ?? null,
        duration: video.duration ?? null,
        downloadStatus: "pending",
        downloadError: null,
        downloadFailedAt: null,
      },
      update: {
        chamber: video.chamber,
        title: video.title,
        sourceUrl: video.url,
        publishedAt: video.publishedAt ?? null,
        duration: video.duration ?? null,
        downloadStatus: "pending",
        downloadError: null,
        downloadFailedAt: null,
      },
    });

    // If file exists treat as previously successful download
    if (fileExists(localPath)) {
      logger.info(`[${label}] File already exists, skipping download`);

      // Save and mark as downloaded
      await saveVideo({ ...video, localPath });

      // Mark transcript as pending
      await markTranscriptPending(video.id);

      // Pass localPath so transcriber can upload and delete
      await transcriptionQueue.add(
        "transcribe",
        { videoId: video.id, localPath },
        { jobId: video.id } // idempotent
      );

      // Update pipeline progress
      pipelineProgress.increment("download");
      return;
    }

    // Ensure target directory exists
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

    try {
      // Download based on source type
      if (video.url.endsWith(".m3u8")) {
        logger.info(`[${label}] Starting HLS download`);
        await downloadHls(video.url, localPath, label);
      } else {
        logger.info(`[${label}] Starting MP4 download`);
        await downloadVideo(video.url, localPath, label, {
          onProgress: async ({ downloadedBytes, totalBytes, bps }) => {
            // Report progress to the queue UI
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

      // Save and mark as downloaded
      await saveVideo({ ...video, localPath });

      // Mark transcript as pending
      await markTranscriptPending(video.id);

      // Pass localPath so transcriber can upload and delete
      await transcriptionQueue.add(
        "transcribe",
        { videoId: video.id, localPath },
        { jobId: video.id }
      );

      // Let logs show the handoff to transcription
      logger.info(`[DOWNLOAD] Enqueued transcription for ${video.id}`);

      // Update pipeline progress
      pipelineProgress.increment("download");
    } catch (err: any) {
      // Cleanup partial files after failure
      try {
        if (fs.existsSync(localPath)) {
          await fs.promises.rm(localPath, { force: true });
        }
        if (fs.existsSync(`${localPath}.part`)) {
          await fs.promises.rm(`${localPath}.part`, { force: true });
        }

        // Remove parts directory if it exists
        if (fs.existsSync(`${localPath}.part.parts`)) {
          await fs.promises.rm(`${localPath}.part.parts`, {
            recursive: true,
            force: true,
          });
        }
      } catch {}

      // Mark DB as failed and keep metadata
      try {
        await prisma.hearingVideo.upsert({
          where: { id: video.id },
          create: {
            id: video.id,
            chamber: video.chamber,
            title: video.title,
            sourceUrl: video.url,
            localPath: null,
            publishedAt: video.publishedAt ?? null,
            duration: video.duration ?? null,
            downloadStatus: "failed",
            downloadError: err?.message || String(err),
            downloadFailedAt: new Date(),
          },
          update: {
            downloadStatus: "failed",
            downloadError: err?.message || String(err),
            downloadFailedAt: new Date(),
          },
        });
      } catch (dbErr) {
        logger.warn({ dbErr }, `[DOWNLOAD FAILED] Could not persist failure status for ${video.id}`);
      }

      // Emit a structured failure log
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
