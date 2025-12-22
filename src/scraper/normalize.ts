import { HearingVideoMetadata } from "../types/video";

export function normalizeVideo(input: {
  id?: string;
  title: string;
  url: string;
  chamber: "house" | "senate";
  publishedAt: Date | null;
  duration?: number | null;
}): HearingVideoMetadata {
  return {
    id: input.id ?? "",
    title: input.title,
    url: input.url,
    publishedAt: input.publishedAt,
    chamber: input.chamber,
    duration: input.duration ?? null,
  };
}

