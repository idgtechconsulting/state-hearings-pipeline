import cliProgress from "cli-progress";

class ProgressTracker {
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
    if (this.started || total === 0) return;
    this.started = true;
    this.bar.start(total, 0);
  }

  increment() {
    if (!this.started) return;
    this.bar.increment();
  }

  stop() {
    if (!this.started) return;
    this.bar.stop();
  }
}

export const progress = new ProgressTracker();
