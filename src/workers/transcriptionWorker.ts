import { Worker, Job } from "bullmq";
import fs from "fs";
import path from "path";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import "../bootstrap";

import {
  markTranscriptDone,
  markTranscriptFailed,
} from "../db/transcriptionRepository";

import { transcribeVideoFile } from "../transcription/transcribeVideo";

// Use the shared redis connection for all queues
import { connection } from "../queue/videoQueue";

import { uploadFileToS3 } from "../storage/s3";

// Toggle for optional S3 uploads
const ENABLE_S3_UPLOAD =
  String(process.env.ENABLE_S3_UPLOAD || "").toLowerCase() === "true";

function safeUnlink(filePath: string) {
  try {
    // Remove a local file if it exists
    if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  } catch {}
}

export const transcriptionWorker = new Worker(
  "video-transcriptions",
  async (job: Job) => {
    // Pull job fields and validate required input
    const { videoId, localPath: jobLocalPath } = job.data as {
      videoId: string;
      localPath?: string;
    };

    if (!videoId) throw new Error("Missing videoId");

    logger.info(`[TRANSCRIBE] Starting job for video ${videoId}`);

    // Load the video record from the database
    const video = await prisma.hearingVideo.findUnique({
      where: { id: videoId },
    });

    if (!video) throw new Error(`Video ${videoId} not found`);

    // Prefer path passed in from downloader
    const localPath = jobLocalPath || video.localPath;

    // Transcription expects a local file
    if (!localPath || localPath.startsWith("s3://")) {
      throw new Error(
        `Missing local file for ${videoId}: ${localPath || "(no path)"}`
      );
    }

    if (!fs.existsSync(localPath)) {
      throw new Error(
        `Missing local file for ${videoId}: ${localPath || "(no path)"}`
      );
    }

    // Skip work if we already have a transcript
    if (video.transcriptStatus === "done" && video.transcript) {
      logger.info(`[TRANSCRIBE] Already done — skipping ${videoId}`);
      return;
    }

    // Write a sidecar transcript file for optional upload
    const transcriptPath = localPath.replace(/\.mp4$/i, ".txt");

    try {
      // 1) Transcribe the local file
      const transcript = await transcribeVideoFile(localPath);

      // 2) Optionally upload MP4 and transcript to S3
      if (ENABLE_S3_UPLOAD) {
        const mp4Key = `videos/${videoId}/${path.basename(localPath)}`;
        logger.info(`[TRANSCRIBE] Uploading MP4 to S3: ${mp4Key}`);
        await uploadFileToS3(localPath, mp4Key);

        // Save transcript so we can upload it as a file
        await fs.promises.writeFile(transcriptPath, transcript, "utf8");
        const txtKey = `videos/${videoId}/transcript.txt`;
        logger.info(`[TRANSCRIBE] Uploading transcript to S3: ${txtKey}`);
        await uploadFileToS3(transcriptPath, txtKey);
      }

      // 3) Persist transcript and status in the database
      await markTranscriptDone(videoId, transcript);

      // 4) Delete local files after DB update
      safeUnlink(transcriptPath);
      safeUnlink(localPath);

      // Report completion with counts and upload status
      logger.info(
        `[TRANSCRIBE] Done ${videoId} (chars=${transcript.length}). Deleted local files${
          ENABLE_S3_UPLOAD ? " (S3 upload enabled)" : ""
        }.`
      );
    } catch (err) {
      // Mark failed so the job can be retried
      await markTranscriptFailed(videoId);
      logger.error(err, `[TRANSCRIBE] Failed ${videoId}`);

      // For retries do not delete MP4 or transcript file
      throw err;
    }
  },
  {
    connection,
    concurrency: Number(process.env.TRANSCRIBE_CONCURRENCY || 2),
  }
);
