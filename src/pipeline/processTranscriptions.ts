import { logger } from "../utils/logger";
import { transcriptionQueue } from "../queue/transcriptionQueue";
import {
  getVideosNeedingTranscription,
  markTranscriptPending,
} from "../db/transcriptionRepository";

export async function processTranscriptions() {
  const videos = await getVideosNeedingTranscription();

  if (videos.length === 0) {
    logger.info("📝 No videos need transcription");
    return;
  }

  logger.info(`📝 Enqueuing ${videos.length} transcription jobs`);

  for (const video of videos) {
    await markTranscriptPending(video.id);

    await transcriptionQueue.add(
      "transcribe",
      { videoId: video.id },
      {
        jobId: video.id, // idempotent
      }
    );
  }
}
