export interface HearingVideoMetadata {
  id: string;
  title: string;
  url: string;
  chamber: "senate" | "house";
  publishedAt?: Date | null;
  duration?: number | null;
}
