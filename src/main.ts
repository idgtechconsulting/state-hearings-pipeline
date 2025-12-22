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
  logger.info("🚀 Pipeline starting");

  // 1️⃣ Scrape
  pipelineProgress.startStage("scrape", 1);
  const videos = await scrapeAll();
  pipelineProgress.increment("scrape");
  pipelineProgress.stopStage("scrape");

  // 2️⃣ Download queue
  pipelineProgress.startStage("download", videos.length);
  await processVideos(videos);

  logger.info("📥 Videos enqueued, waiting for download workers…");
  await waitForQueueIdle(videoQueue, "download");

  pipelineProgress.stopStage("download");

  // 3️⃣ Transcription queue
  pipelineProgress.startStage("transcribe", 1);
  await processTranscriptions();

  logger.info("📝 Transcriptions enqueued, waiting for transcription workers…");
  await waitForQueueIdle(transcriptionQueue, "transcribe");

  pipelineProgress.stopStage("transcribe");

  logger.info("✅ Pipeline complete");
}

main()
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error(err, "❌ Pipeline failed");
    await prisma.$disconnect();
    process.exit(1);
  });
