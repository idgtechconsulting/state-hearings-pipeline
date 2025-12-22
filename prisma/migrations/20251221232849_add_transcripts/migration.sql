-- AlterTable
ALTER TABLE "HearingVideo" ADD COLUMN     "transcribedAt" TIMESTAMP(3),
ADD COLUMN     "transcript" TEXT,
ADD COLUMN     "transcriptStatus" TEXT;
