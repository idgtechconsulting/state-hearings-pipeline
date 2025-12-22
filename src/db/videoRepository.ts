// src/db/videoRepository.ts
import { prisma } from "../db/client";
import type { HearingVideoMetadata } from "../types/video";

export async function videoExists(id: string) {
  return prisma.hearingVideo.findUnique({
    where: { id },
    select: { id: true },
  });
}

export async function saveVideo(
  video: HearingVideoMetadata & { localPath: string }
) {
  return prisma.hearingVideo.create({
    data: {
      id: video.id!,
      chamber: video.chamber,
      title: video.title,
      sourceUrl: video.url,
      localPath: video.localPath,
      publishedAt: video.publishedAt,
      duration: video.duration,
      downloadedAt: new Date(),
    },
  });
}
