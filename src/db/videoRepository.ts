import { prisma } from "../db/client";
import type { HearingVideoMetadata } from "../types/video";

// Check for an existing video by id
export async function videoExists(id: string) {
  return prisma.hearingVideo.findUnique({
    where: { id },
    select: { id: true },
  });
}

// Upsert a fully downloaded video with metadata
export async function saveVideo(
  video: HearingVideoMetadata & { localPath: string }
) {
  return prisma.hearingVideo.upsert({
    where: { id: video.id },
    create: {
      id: video.id,
      chamber: video.chamber,
      title: video.title,
      sourceUrl: video.url,
      localPath: video.localPath,
      publishedAt: video.publishedAt,
      duration: video.duration,
      downloadedAt: new Date(),
      downloadStatus: "done",
      downloadError: null,
      downloadFailedAt: null,
    },
    update: {
      // Keep metadata fresh if it changes slightly across runs
      chamber: video.chamber,
      title: video.title,
      sourceUrl: video.url,
      localPath: video.localPath,
      publishedAt: video.publishedAt,
      duration: video.duration,
      downloadedAt: new Date(),
      downloadStatus: "done",
      downloadError: null,
      downloadFailedAt: null,
    },
  });
}

// Create or update a pending download record
export async function markDownloadPending(id: string) {
  return prisma.hearingVideo.upsert({
    where: { id },
    create: {
      id,
      chamber: "unknown",
      title: "unknown",
      sourceUrl: "unknown",
      downloadStatus: "pending",
    },
    update: {
      downloadStatus: "pending",
      downloadError: null,
      downloadFailedAt: null,
    },
  });
}

// Record a download failure with error details
export async function markDownloadFailed(id: string, error: string) {
  return prisma.hearingVideo.update({
    where: { id },
    data: {
      downloadStatus: "failed",
      downloadError: error,
      downloadFailedAt: new Date(),
    },
  });
}
