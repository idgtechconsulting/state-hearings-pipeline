import axios from "axios";
import { logger } from "../utils/logger";
import { normalizeVideo } from "./normalize";
import type { HearingVideoMetadata } from "../types/video";
import {
  startSpinner,
  updateSpinner,
  succeedSpinner,
} from "../utils/spinner";

// Work out the date we use to stop scanning older videos
const TWO_MONTHS_AGO = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  return d;
})();

// Get the streaming link for a Castus video ID
async function resolveCastusStreamUrl(id: string): Promise<string | null> {
  try {
    const { data } = await axios.post(
      "https://imd0mxanj2.execute-api.us-west-2.amazonaws.com/upload/get",
      { file: id, type: "HLS", user: "" },
      { headers: { "Content-Type": "application/json" }, timeout: 10_000 }
    );

    // The API puts the streaming link inside data.response.payload.data
    const hls = data?.response?.payload?.data;
    return typeof hls === "string" ? hls : null;
  } catch {
    // Keep going even if one lookup fails
    logger.error(`Failed to resolve Castus stream URL for video ID: ${id}`);
    return null;
  }
}

export async function scrapeSenate(): Promise<HearingVideoMetadata[]> {
  // The Senate API address comes from the environment
  const apiUrl = process.env.SENATE_API_URL!;
  const results: HearingVideoMetadata[] = [];

  // Track which page we are on and basic counts for progress
  let page = 1;
  let scanned = 0;
  let playable = 0;
  let shouldContinue = true;

  startSpinner("Scanning Senate videos…");

  while (shouldContinue) {
    // Fetch one page of archive results
    const { data } = await axios.post(apiUrl, {
      _id: "61b3adc8124d7d000891ca5c",
      page,
      results: "50",
    });

    // Stop when the API returns no items
    const files = data?.allFiles;
    if (!Array.isArray(files) || files.length === 0) break;

    for (const item of files) {
      scanned++;

      // Stop once we hit older videos since the list is newest first
      const publishedAt = new Date(item.date || item.original_date);
      if (publishedAt < TWO_MONTHS_AGO) {
        shouldContinue = false;
        break;
      }

      // Only include items that are ready to play
      if (!item.transcoded) continue;

      // Look up the streaming link for this video
      const videoUrl = await resolveCastusStreamUrl(item._id);
      if (!videoUrl) continue;

      playable++;

      // Keep the on-screen progress up to date
      updateSpinner(
        `Scanned ${scanned}, playable ${playable}, page ${page}`
      );

      // Convert to the standard video shape used by the pipeline
      results.push(
        normalizeVideo({
          id: item._id,
          title: item.metadata?.filename ?? "video",
          url: videoUrl,
          publishedAt,
          chamber: "senate",
          duration: Number(item.metadata?.duration) || null,
        })
      );
    }

    page++;
  }

  succeedSpinner(
    `Senate scrape complete: ${playable} playable (scanned ${scanned})`
  );

  return results;
}
