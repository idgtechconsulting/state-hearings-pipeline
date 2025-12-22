import { videoQueue } from "./videoQueue";

async function clear() {
  console.log("🧹 Clearing video queue...");
  await videoQueue.drain(true); // removes waiting + delayed
  await videoQueue.clean(0, 1000, "completed");
  await videoQueue.clean(0, 1000, "failed");
  console.log("✅ Queue cleared");
  process.exit(0);
}

clear();
