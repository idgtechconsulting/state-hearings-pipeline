import os from "os";
import path from "path";
import { extractAudioSegments, safeRmDir } from "./ffmpegSegments";
import { transcribeAudioFile } from "./openaiTranscribe";

export async function transcribeVideoFile(videoPath: string): Promise<string> {
  const tempDir = path.join(
    os.tmpdir(),
    `state-hearings-transcribe-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  try {
    const segments = await extractAudioSegments(videoPath, tempDir, 600);

    const parts: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const text = await transcribeAudioFile(segments[i]);
      parts.push(text.trim());
    }

    return parts.filter(Boolean).join("\n\n");
  } finally {
    safeRmDir(tempDir);
  }
}
