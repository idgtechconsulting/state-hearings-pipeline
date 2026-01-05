import { HearingVideoMetadata } from "../types/video";

// Minimal input shape used by scrapers before normalization
export function normalizeVideo(input: {
  id?: string;
  title: string;
  url: string;
  chamber: "house" | "senate";
  publishedAt: Date | null;
  duration?: number | null;
}): HearingVideoMetadata {
  // Normalize optional fields so downstream code sees consistent values
  return {
    id: input.id ?? "",
    title: input.title,
    url: input.url,
    publishedAt: input.publishedAt,
    chamber: input.chamber,
    duration: input.duration ?? null,
  };
}
