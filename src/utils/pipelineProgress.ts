// src/utils/pipelineProgress.ts
import cliProgress from "cli-progress";

type Stage = "scrape" | "download" | "transcribe";

class PipelineProgress {
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
    if (this.stageBars.has(stage)) return;

    const bar = this.bars.create(total, 0, {
      stage: stage.toUpperCase().padEnd(12),
    });

    this.stageBars.set(stage, bar);
  }

  increment(stage: Stage) {
    const bar = this.stageBars.get(stage);
    if (bar) bar.increment();
  }

  stopStage(stage: Stage) {
    const bar = this.stageBars.get(stage);
    if (bar) bar.stop();
  }

  stopAll() {
    this.bars.stop();
  }
}

export const pipelineProgress = new PipelineProgress();
