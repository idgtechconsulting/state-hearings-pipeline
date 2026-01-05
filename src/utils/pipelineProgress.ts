import cliProgress from "cli-progress";

type Stage = "scrape" | "download" | "transcribe";

class PipelineProgress {
  // Shared multibar for stage level progress
  private bars = new cliProgress.MultiBar(
    {
      clearOnComplete: false,
      hideCursor: true,
      format:
        "{stage} |{bar}| {value}/{total} | ETA: {eta_formatted}",
    },
    cliProgress.Presets.shades_classic
  );

  private stageBars = new Map<Stage, cliProgress.SingleBar>();

  startStage(stage: Stage, total: number) {
    // Skip if the stage already has a bar
    if (this.stageBars.has(stage)) return;

    // Create a new bar with a fixed width stage label
    const bar = this.bars.create(total, 0, {
      stage: stage.toUpperCase().padEnd(12),
    });

    this.stageBars.set(stage, bar);
  }

  increment(stage: Stage) {
    // Bump the bar for the given stage
    const bar = this.stageBars.get(stage);
    if (bar) bar.increment();
  }

  stopStage(stage: Stage) {
    // Stop the stage bar without clearing the screen
    const bar = this.stageBars.get(stage);
    if (bar) bar.stop();
  }

  stopAll() {
    // Stop all bars at once
    this.bars.stop();
  }
}

// Shared instance used by the pipeline
export const pipelineProgress = new PipelineProgress();
