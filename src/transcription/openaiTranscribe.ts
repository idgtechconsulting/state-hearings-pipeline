import fs from "fs";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function transcribeAudioFile(audioPath: string): Promise<string> {
  const model = process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

  const file = fs.createReadStream(audioPath);

  const result = await client.audio.transcriptions.create({
    model,
    file,
    response_format: "text",
  });

  return typeof result === "string" ? result : ((result as any).text ?? "");
}
