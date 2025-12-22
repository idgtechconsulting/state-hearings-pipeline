-- AlterTable
ALTER TABLE "HearingVideo" ADD COLUMN     "downloadError" TEXT,
ADD COLUMN     "downloadFailedAt" TIMESTAMP(3),
ADD COLUMN     "downloadStatus" TEXT;
