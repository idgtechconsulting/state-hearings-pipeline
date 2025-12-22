-- CreateTable
CREATE TABLE "HearingVideo" (
    "id" TEXT NOT NULL,
    "chamber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "localPath" TEXT,
    "publishedAt" TIMESTAMP(3),
    "duration" DOUBLE PRECISION,
    "downloadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HearingVideo_pkey" PRIMARY KEY ("id")
);
