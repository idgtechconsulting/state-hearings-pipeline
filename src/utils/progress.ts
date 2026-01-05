import cliProgress from "cli-progress";

class ProgressTracker {
  // Single bar for download batch progress
  private bar = new cliProgress.SingleBar(
    {
      format:
        "🎬 Downloading |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  private started = false;

  start(total: number) {
    // Avoid double starts or empty totals
    if (this.started || total === 0) return;
    this.started = true;
    this.bar.start(total, 0);
  }

  increment() {
    // Ignore increments if not started
    if (!this.started) return;
    this.bar.increment();
  }

  stop() {
    // Stop the bar only once
    if (!this.started) return;
    this.bar.stop();
  }
}

// Shared progress tracker for downloads
export const progress = new ProgressTracker();
