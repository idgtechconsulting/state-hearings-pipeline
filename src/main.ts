import "./bootstrap";
import "dotenv/config";

import { scrapeAll } from "./scraper";
import { prisma } from "./db/client";
import { logger } from "./utils/logger";
import { processVideos } from "./pipeline/processVideos";
import { pipelineProgress } from "./utils/pipelineProgress";

import { videoQueue } from "./queue/videoQueue";
import { transcriptionQueue } from "./queue/transcriptionQueue";
import { waitForQueueIdle } from "./utils/waitForQueueIdle";
import { processTranscriptions } from "./pipeline/processTranscriptions";

async function main() {
  // Announce pipeline start
  logger.info("🚀 Pipeline starting");

  // 1️⃣ Scrape to collect video metadata
  pipelineProgress.startStage("scrape", 1);
  const videos = await scrapeAll();
  pipelineProgress.increment("scrape");
  pipelineProgress.stopStage("scrape");

  // 2️⃣ Queue downloads for all scraped videos
  pipelineProgress.startStage("download", videos.length);
  await processVideos(videos);

  // Wait for downloads to finish
  logger.info("📥 Videos enqueued, waiting for download workers…");
  await waitForQueueIdle(videoQueue, "download");

  pipelineProgress.stopStage("download");

  // 3️⃣ Queue transcription jobs
  pipelineProgress.startStage("transcribe", 1);
  await processTranscriptions();

  // Wait for transcriptions to finish
  logger.info("📝 Transcriptions enqueued, waiting for transcription workers…");
  await waitForQueueIdle(transcriptionQueue, "transcribe");

  pipelineProgress.stopStage("transcribe");

  // All stages are done
  logger.info("✅ Pipeline complete");
}

main()
  .then(async () => {
    // Graceful shutdown on success
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    // Log and shutdown on failure
    logger.error(err, "❌ Pipeline failed");
    await prisma.$disconnect();
    process.exit(1);
  });
