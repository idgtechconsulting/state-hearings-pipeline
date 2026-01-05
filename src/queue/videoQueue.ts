import { Queue } from "bullmq";
import IORedis from "ioredis";

// Shared Redis connection for all queues
export const connection = new IORedis(
  process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  {
    // Required by BullMQ to avoid retry limits on blocked connections
    maxRetriesPerRequest: null, // 🚨 REQUIRED by BullMQ
  }
);

// Queue for video download jobs
export const videoQueue = new Queue("video-downloads", {
  connection,
  defaultJobOptions: {
    // Retry with exponential backoff for transient download issues
    attempts: 5, // retries
    backoff: {
      type: "exponential",
      delay: 30_000, // 30s → 60s → 120s…
    },
    // Keep only failures for debugging
    removeOnComplete: true,
    removeOnFail: false,
  },
});
