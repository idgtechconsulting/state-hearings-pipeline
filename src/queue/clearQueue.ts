import { videoQueue } from "./videoQueue";

async function clear() {
  // Announce the cleanup to the operator
  console.log("🧹 Clearing video queue...");
  // Remove waiting and delayed jobs first
  await videoQueue.drain(true); // removes waiting + delayed
  // Purge completed and failed jobs from storage
  await videoQueue.clean(0, 1000, "completed");
  await videoQueue.clean(0, 1000, "failed");
  // Confirm completion then exit
  console.log("✅ Queue cleared");
  process.exit(0);
}

// Run immediately when executed as a script
clear();
