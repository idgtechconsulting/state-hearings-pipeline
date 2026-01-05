import { logger } from "../utils/logger";
import { videoExists } from "../db/videoRepository";
import type { HearingVideoMetadata } from "../types/video";
import { videoQueue } from "../queue/videoQueue";
import { progress } from "../utils/progress";

export async function processVideos(videos: HearingVideoMetadata[]) {
  let enqueued = 0;
  let skipped = 0;

  // Initialize progress tracking for the incoming list
  progress.start(videos.length);

  for (const video of videos) {
    // Skip invalid entries without an id
    if (!video?.id) continue;

    // Avoid duplicate work if we already stored this video
    const exists = await videoExists(video.id);
    if (exists) {
      skipped++;
      // Keep the progress bar moving for skipped items
      progress.increment();
      continue;
    }

    // Enqueue with retries to handle transient download failures
    await videoQueue.add("download", video, {
      jobId: video.id,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 30_000, // 30s, then 60s, then 120s
      },
    });
    enqueued++;
    // Advance progress for each queued video
    progress.increment();
  }

  // Summarize how many were queued vs skipped
  logger.info(`Queue ready — ${enqueued} new videos, ${skipped} already downloaded`);
}
