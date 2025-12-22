// src/workers/transcriptionWorker.ts
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

// ✅ IMPORTANT: use the transcription queue connection (or same redis connection)
import { connection } from "../queue/videoQueue";

import { uploadFileToS3 } from "../storage/s3";

const ENABLE_S3_UPLOAD =
  String(process.env.ENABLE_S3_UPLOAD || "").toLowerCase() === "true";

function safeUnlink(filePath: string) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  } catch {}
}

export const transcriptionWorker = new Worker(
  "video-transcriptions",
  async (job: Job) => {
    const { videoId, localPath: jobLocalPath } = job.data as {
      videoId: string;
      localPath?: string;
    };

    if (!videoId) throw new Error("Missing videoId");

    logger.info(`[TRANSCRIBE] Starting job for video ${videoId}`);

    const video = await prisma.hearingVideo.findUnique({
      where: { id: videoId },
    });

    if (!video) throw new Error(`Video ${videoId} not found`);

    // ✅ prefer path passed in from downloader
    const localPath = jobLocalPath || video.localPath;

    // For this challenge, transcription expects a local file.
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

    if (video.transcriptStatus === "done" && video.transcript) {
      logger.info(`[TRANSCRIBE] Already done — skipping ${videoId}`);
      return;
    }

    // We'll write transcript to a sidecar file (useful even if S3 disabled)
    const transcriptPath = localPath.replace(/\.mp4$/i, ".txt");

    try {
      // 1) Transcribe
      const transcript = await transcribeVideoFile(localPath);

      // 2) Optional: Upload to S3 (toggled)
      if (ENABLE_S3_UPLOAD) {
        const mp4Key = `videos/${videoId}/${path.basename(localPath)}`;
        logger.info(`[TRANSCRIBE] Uploading MP4 to S3: ${mp4Key}`);
        await uploadFileToS3(localPath, mp4Key);

        await fs.promises.writeFile(transcriptPath, transcript, "utf8");
        const txtKey = `videos/${videoId}/transcript.txt`;
        logger.info(`[TRANSCRIBE] Uploading transcript to S3: ${txtKey}`);
        await uploadFileToS3(transcriptPath, txtKey);
      }

      // 3) Mark done in DB
      await markTranscriptDone(videoId, transcript);

      // 4) Delete local files AFTER DB update
      safeUnlink(transcriptPath);
      safeUnlink(localPath);

      logger.info(
        `[TRANSCRIBE] Done ${videoId} (chars=${transcript.length}). Deleted local files${
          ENABLE_S3_UPLOAD ? " (S3 upload enabled)" : ""
        }.`
      );
    } catch (err) {
      await markTranscriptFailed(videoId);
      logger.error(err, `[TRANSCRIBE] Failed ${videoId}`);

      // For retries: DO NOT delete MP4 on failure
      // (We also avoid deleting transcriptPath here.)
      throw err;
    }
  },
  {
    connection,
    concurrency: Number(process.env.TRANSCRIBE_CONCURRENCY || 2),
  }
);
