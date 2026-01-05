import os from "os";
import path from "path";
import { extractAudioSegments, safeRmDir } from "./ffmpegSegments";
import { transcribeAudioFile } from "./openaiTranscribe";

export async function transcribeVideoFile(videoPath: string): Promise<string> {
  // Create a unique temp directory for audio segments
  const tempDir = path.join(
    os.tmpdir(),
    `state-hearings-transcribe-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  try {
    // Split the video into smaller audio chunks
    const segments = await extractAudioSegments(videoPath, tempDir, 600);

    // Transcribe each segment sequentially to preserve order
    const parts: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const text = await transcribeAudioFile(segments[i]);
      parts.push(text.trim());
    }

    // Stitch parts into a single transcript
    return parts.filter(Boolean).join("\n\n");
  } finally {
    // Always cleanup temp files
    safeRmDir(tempDir);
  }
}
