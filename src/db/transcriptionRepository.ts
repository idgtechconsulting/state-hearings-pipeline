import { prisma } from "./client";

export async function getVideosNeedingTranscription() {
  return prisma.hearingVideo.findMany({
    where: {
      localPath: { not: null },
      transcript: null,
      OR: [
        { transcriptStatus: null },
        { transcriptStatus: "failed" },
      ],
    },
  });
}

export async function markTranscriptPending(videoId: string) {
  await prisma.hearingVideo.update({
    where: { id: videoId },
    data: {
      transcriptStatus: "pending",
    },
  });
}

export async function markTranscriptDone(videoId: string, transcript: string) {
  await prisma.hearingVideo.update({
    where: { id: videoId },
    data: {
      transcript,
      transcriptStatus: "done",
      transcribedAt: new Date(),
    },
  });
}

export async function markTranscriptFailed(videoId: string) {
  await prisma.hearingVideo.update({
    where: { id: videoId },
    data: {
      transcriptStatus: "failed",
    },
  });
}
