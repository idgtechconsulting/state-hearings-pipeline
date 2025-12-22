// src/utils/waitForQueueIdle.ts
import cliProgress from "cli-progress";
import type { Queue } from "bullmq";
import { QueueEvents } from "bullmq";
import { connection } from "../queue/videoQueue";
import { logger } from "./logger";

type DownloadProgressPayload = {
  stage?: string;
  title?: string;
  downloadedBytes?: number;
  totalBytes?: number | null;
  bps?: number | null; // bytes/sec
};

const MAX_ACTIVE_BARS = Math.max(
  1,
  Math.min(12, Number(process.env.MAX_ACTIVE_DOWNLOAD_BARS || "6"))
);

function formatBytes(n: number) {
  if (!Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let x = n;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)}${units[i]}`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function shortTitle(s: string, max = 28) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

export async function waitForQueueIdle(
  queue: Queue,
  stageLabel: "download" | "transcribe"
) {
  const totalJobs = await queue.getJobCountByTypes("waiting", "active", "delayed");
  if (!totalJobs) {
    logger.info(`⏳ ${stageLabel}: queue empty`);
    return;
  }

  logger.info(`⏳ ${stageLabel}: waiting for queue to drain (${totalJobs} jobs)`);

  const qe = new QueueEvents(queue.name, { connection });

  // Per-job tracking
  const totalsByJob = new Map<string, number>(); // jobId -> totalBytes
  const doneBytesByJob = new Map<string, number>(); // jobId -> downloadedBytes
  const titleByJob = new Map<string, string>(); // jobId -> title
  const bpsByJob = new Map<string, number>(); // jobId -> bps

  const completed = new Set<string>();
  let failed = 0;

  // We render bars only for active jobs (up to MAX_ACTIVE_BARS)
  const barByJob = new Map<string, cliProgress.SingleBar>();

  const multibar = new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format: "{label} |{bar}| {meta}",
    },
    cliProgress.Presets.shades_classic
  );

  // Batch bar
  const batchBar = multibar.create(1000, 0, {
    label: stageLabel.toUpperCase().padEnd(10),
    meta: "starting…",
  });

  function ensureJobBar(jobId: string) {
    let bar = barByJob.get(jobId);
    if (bar) return bar;

    // limit how many per-job bars we render
    if (barByJob.size >= MAX_ACTIVE_BARS) return null;

    bar = multibar.create(1000, 0, {
      label: "FILE".padEnd(10),
      meta: shortTitle(titleByJob.get(jobId) || jobId),
    });

    barByJob.set(jobId, bar);
    return bar;
  }

  function dropJobBar(jobId: string) {
    const bar = barByJob.get(jobId);
    if (!bar) return;
    try {
      bar.stop();
    } catch {}
    barByJob.delete(jobId);
  }

  function recomputeBatch() {
    let totalBytes = 0;
    let doneBytes = 0;
    let bpsSum = 0;

    for (const [jobId, t] of totalsByJob) {
      totalBytes += t || 0;
      doneBytes += doneBytesByJob.get(jobId) || 0;
      bpsSum += bpsByJob.get(jobId) || 0;
    }

    const completedCount = completed.size;
    const inFlight = totalJobs - completedCount - failed;

    const pct =
      totalBytes > 0 ? doneBytes / totalBytes : completedCount / totalJobs;

    const remaining = Math.max(0, totalBytes - doneBytes);
    const etaSeconds =
      totalBytes > 0 && bpsSum > 0 ? remaining / bpsSum : Number.NaN;

    batchBar.update(Math.floor(pct * 1000), {
      meta:
        totalBytes > 0
          ? `${formatBytes(doneBytes)} / ${formatBytes(totalBytes)} • ${formatBytes(
              bpsSum
            )}/s • ETA ${formatDuration(etaSeconds)} • done ${completedCount}/${totalJobs} • failed ${failed} • active ${inFlight}`
          : `done ${completedCount}/${totalJobs} • failed ${failed} • active ${inFlight}`,
    });
  }

  function updateJobBar(jobId: string) {
    // Only show per-file bars for downloads (transcribe can be added later)
    if (stageLabel !== "download") return;

    if (completed.has(jobId)) {
      dropJobBar(jobId);
      return;
    }

    const title = titleByJob.get(jobId) || jobId;
    const done = doneBytesByJob.get(jobId) || 0;
    const total = totalsByJob.get(jobId) || 0;
    const bps = bpsByJob.get(jobId) || 0;

    const bar = ensureJobBar(jobId);
    if (!bar) return;

    const pct = total > 0 ? done / total : 0;
    const remaining = total > 0 ? Math.max(0, total - done) : 0;
    const etaSeconds = bps > 0 && total > 0 ? remaining / bps : Number.NaN;

    bar.update(Math.floor(pct * 1000), {
      label: shortTitle(title, 10).padEnd(10),
      meta:
        total > 0
          ? `${formatBytes(done)}/${formatBytes(total)} • ${formatBytes(
              bps
            )}/s • ETA ${formatDuration(etaSeconds)}`
          : `${formatBytes(done)} • ${formatBytes(bps)}/s`,
    });
  }

  function enforceActiveBarLimit() {
    // If we have more bars than allowed (due to race), trim arbitrary extras.
    while (barByJob.size > MAX_ACTIVE_BARS) {
      const [jobId] = barByJob.keys();
      dropJobBar(jobId);
    }
  }

  qe.on("progress", ({ jobId, data }) => {
    if (!jobId) return;
    if (!data || typeof data !== "object") return;

    const p = data as DownloadProgressPayload;

    // Only handle download progress payloads
    if (stageLabel === "download" && p.stage === "download") {
      if (typeof p.title === "string") titleByJob.set(jobId, p.title);
      if (typeof p.totalBytes === "number" && p.totalBytes > 0) {
        totalsByJob.set(jobId, p.totalBytes);
      }
      if (typeof p.downloadedBytes === "number") {
        doneBytesByJob.set(jobId, p.downloadedBytes);
      }
      if (typeof p.bps === "number" && p.bps >= 0) {
        bpsByJob.set(jobId, p.bps);
      }

      recomputeBatch();
      updateJobBar(jobId);
      enforceActiveBarLimit();
    }
  });

  qe.on("completed", ({ jobId }) => {
    if (jobId) {
      completed.add(jobId);
      dropJobBar(jobId);
    }
    recomputeBatch();
  });

  qe.on("failed", ({ jobId }) => {
    if (jobId) {
      completed.add(jobId);
      dropJobBar(jobId);
    }
    failed++;
    recomputeBatch();
  });

  // Initial render
  recomputeBatch();

  // Poll until drained
  while (true) {
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed"
    );
    const pending =
      (counts.waiting || 0) + (counts.active || 0) + (counts.delayed || 0);

    if (pending === 0) break;

    await new Promise((r) => setTimeout(r, 500));
  }

  await qe.close();
  multibar.stop();
  logger.info(`✅ ${stageLabel}: queue drained`);
}
