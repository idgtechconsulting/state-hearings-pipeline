// Shared video metadata shape used across the pipeline
export interface HearingVideoMetadata {
  id: string;
  title: string;
  url: string;
  // Chamber is normalized to a fixed union
  chamber: "senate" | "house";
  publishedAt?: Date | null;
  duration?: number | null;
}
