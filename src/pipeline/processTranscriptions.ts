import { logger } from "../utils/logger";
import { transcriptionQueue } from "../queue/transcriptionQueue";
import {
  getVideosNeedingTranscription,
  markTranscriptPending,
} from "../db/transcriptionRepository";

export async function processTranscriptions() {
  // Load any videos that still need transcription
  const videos = await getVideosNeedingTranscription();

  if (videos.length === 0) {
    // Nothing to queue so we can return early
    logger.info("📝 No videos need transcription");
    return;
  }

  // Report the batch size before enqueuing jobs
  logger.info(`📝 Enqueuing ${videos.length} transcription jobs`);

  for (const video of videos) {
    // Mark as pending so the job is idempotent
    await markTranscriptPending(video.id);

    // Queue the transcription job for the worker
    await transcriptionQueue.add(
      "transcribe",
      { videoId: video.id },
      {
        jobId: video.id, // idempotent
      }
    );
  }
}
