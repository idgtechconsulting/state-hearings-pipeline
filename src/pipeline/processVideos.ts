// src/pipeline/processVideos.ts
import { logger } from "../utils/logger";
import { videoExists } from "../db/videoRepository";
import type { HearingVideoMetadata } from "../types/video";
import { videoQueue } from "../queue/videoQueue";
import { progress } from "../utils/progress";

export async function processVideos(videos: HearingVideoMetadata[]) {
  let enqueued = 0;
  let skipped = 0;

  // Start bar with total videos we intend to process (or just videos.length)
  progress.start(videos.length);

  for (const video of videos) {
    if (!video?.id) continue;

    const exists = await videoExists(video.id);
    if (exists) {
      skipped++;
      progress.increment(); // show movement
      continue;
    }

    await videoQueue.add("download", video, {
      jobId: video.id,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 30_000, // 30s, then 60s, then 120s
      },
    });
    enqueued++;
    progress.increment();
  }

  logger.info(`Queue ready — ${enqueued} new videos, ${skipped} already downloaded`);
}
