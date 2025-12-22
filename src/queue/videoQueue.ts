import { Queue } from "bullmq";
import IORedis from "ioredis";

export const connection = new IORedis(
  process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  {
    maxRetriesPerRequest: null, // 🚨 REQUIRED by BullMQ
  }
);

export const videoQueue = new Queue("video-downloads", {
  connection,
  defaultJobOptions: {
    attempts: 5,               // retries
    backoff: {
      type: "exponential",
      delay: 30_000,           // 30s → 60s → 120s…
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
