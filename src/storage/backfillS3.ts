import fs from "fs";
import path from "path";
import { prisma } from "../db/client";
import { uploadFileToS3 } from "../storage/s3";
import { logger } from "../utils/logger";

async function main() {
  // Load senate videos that still live on local disk
  const senateVideos = await prisma.hearingVideo.findMany({
    where: {
      chamber: "senate",
      localPath: { not: null },
    },
  });

  // Report how many videos are eligible for upload
  logger.info(`Found ${senateVideos.length} senate videos to backfill`);

  for (const video of senateVideos) {
    // Build the target key for this local file
    const localPath = video.localPath!;
    const fileName = path.basename(localPath);
    const s3Key = `videos/senate/${video.id}/${fileName}`;

    // Skip when the local file is missing
    if (!fs.existsSync(localPath)) {
      logger.warn(`[SKIP] Missing local file for ${video.id}`);
      continue;
    }

    try {
      // Log the full S3 destination for visibility
      logger.info(
        `[UPLOAD] ${video.id} → s3://${process.env.S3_BUCKET}/${s3Key}`
      );

      // Upload the file to S3
      await uploadFileToS3(localPath, s3Key);

      // Replace localPath with the S3 URI in the database
      const s3Uri = `s3://${process.env.S3_BUCKET}/${s3Key}`;

      await prisma.hearingVideo.update({
        where: { id: video.id },
        data: {
          localPath: s3Uri, // ✅ now points to S3
        },
      });

      // Delete the local file after the DB update
      await fs.promises.rm(localPath, { force: true });

      // Confirm success for this video
      logger.info(`[DONE] ${video.id}`);
    } catch (err) {
      // Log failures and continue to the next item
      logger.error(err, `[FAILED] ${video.id}`);
    }
  }

  // Wrap up and close the database connection
  logger.info("Backfill complete");
  await prisma.$disconnect();
}

// Run as a script with a hard failure path
main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
