// Status enum used by the pipeline state machine
export type VideoStatus =
  | "new"
  | "downloading"
  | "downloaded"
  | "transcribing"
  | "transcribed"
  | "embedding"
  | "embedded"
  | "summarizing"
  | "complete"
  | "error";

// Minimal video record shape stored in the database
export interface VideoRecord {
  id: string;
  title: string;
  url: string;
  published_at: Date | null;
  status: VideoStatus;
  retry_count: number;
  error?: string | null;
}
