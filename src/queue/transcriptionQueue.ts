import { Queue } from "bullmq";
import { connection } from "./videoQueue"; // reuse same Redis connection

export const transcriptionQueue = new Queue("video-transcriptions", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 60_000, // 1 min → 2 min → 4 min
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
