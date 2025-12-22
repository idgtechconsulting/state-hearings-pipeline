import fs from "fs";
import path from "path";
import { prisma } from "../db/client";
import { uploadFileToS3 } from "../storage/s3";
import { logger } from "../utils/logger";

async function main() {
  const senateVideos = await prisma.hearingVideo.findMany({
    where: {
      chamber: "senate",
      localPath: { not: null },
    },
  });

  logger.info(`Found ${senateVideos.length} senate videos to backfill`);

  for (const video of senateVideos) {
    const localPath = video.localPath!;
    const fileName = path.basename(localPath);
    const s3Key = `videos/senate/${video.id}/${fileName}`;

    if (!fs.existsSync(localPath)) {
      logger.warn(`[SKIP] Missing local file for ${video.id}`);
      continue;
    }

    try {
      logger.info(
        `[UPLOAD] ${video.id} → s3://${process.env.S3_BUCKET}/${s3Key}`
      );

      // upload to S3
      await uploadFileToS3(localPath, s3Key);

      // overwrite localPath with S3 URI
      const s3Uri = `s3://${process.env.S3_BUCKET}/${s3Key}`;

      await prisma.hearingVideo.update({
        where: { id: video.id },
        data: {
          localPath: s3Uri, // ✅ now points to S3
        },
      });

      // delete local file after DB update
      await fs.promises.rm(localPath, { force: true });

      logger.info(`[DONE] ${video.id}`);
    } catch (err) {
      logger.error(err, `[FAILED] ${video.id}`);
    }
  }

  logger.info("Backfill complete");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
