import { prisma } from "./client";

// Find videos that are ready to be transcribed
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

// Mark a transcript job as queued
export async function markTranscriptPending(videoId: string) {
  await prisma.hearingVideo.update({
    where: { id: videoId },
    data: {
      transcriptStatus: "pending",
    },
  });
}

// Store transcript text and mark completion
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

// Mark a transcript attempt as failed
export async function markTranscriptFailed(videoId: string) {
  await prisma.hearingVideo.update({
    where: { id: videoId },
    data: {
      transcriptStatus: "failed",
    },
  });
}
