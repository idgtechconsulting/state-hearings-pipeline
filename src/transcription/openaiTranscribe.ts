import fs from "fs";
import OpenAI from "openai";

// Shared OpenAI client for audio transcription
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function transcribeAudioFile(audioPath: string): Promise<string> {
  // Allow model override via env for easy swaps
  const model = process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

  // Stream the audio file to avoid loading into memory
  const file = fs.createReadStream(audioPath);

  // Request a plain text transcription
  const result = await client.audio.transcriptions.create({
    model,
    file,
    response_format: "text",
  });

  // Normalize the response into a simple string
  return typeof result === "string" ? result : ((result as any).text ?? "");
}
