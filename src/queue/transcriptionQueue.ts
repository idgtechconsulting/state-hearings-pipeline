import { Queue } from "bullmq";
import { connection } from "./videoQueue"; // reuse same Redis connection

// Dedicated queue for transcription jobs using shared Redis
export const transcriptionQueue = new Queue("video-transcriptions", {
  connection,
  defaultJobOptions: {
    // Retry with exponential backoff for transient failures
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 60_000, // 1 min → 2 min → 4 min
    },
    // Keep only failures for inspection
    removeOnComplete: true,
    removeOnFail: false,
  },
});
