import axios from "axios";
import { logger } from "../utils/logger";
import { normalizeVideo } from "./normalize";
import type { HearingVideoMetadata } from "../types/video";
import {
  startSpinner,
  updateSpinner,
  succeedSpinner,
} from "../utils/spinner";

const TWO_MONTHS_AGO = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  return d;
})();

async function resolveCastusStreamUrl(id: string): Promise<string | null> {
  try {
    const { data } = await axios.post(
      "https://imd0mxanj2.execute-api.us-west-2.amazonaws.com/upload/get",
      { file: id, type: "HLS", user: "" },
      { headers: { "Content-Type": "application/json" }, timeout: 10_000 }
    );

    const hls = data?.response?.payload?.data;
    return typeof hls === "string" ? hls : null;
  } catch {
    logger.error(`Failed to resolve Castus stream URL for video ID: ${id}`);
    return null;
  }
}

export async function scrapeSenate(): Promise<HearingVideoMetadata[]> {
  const apiUrl = process.env.SENATE_API_URL!;
  const results: HearingVideoMetadata[] = [];

  let page = 1;
  let scanned = 0;
  let playable = 0;
  let shouldContinue = true;

  startSpinner("Scanning Senate videos…");

  while (shouldContinue) {
    const { data } = await axios.post(apiUrl, {
      _id: "61b3adc8124d7d000891ca5c",
      page,
      results: "50",
    });

    const files = data?.allFiles;
    if (!Array.isArray(files) || files.length === 0) break;

    for (const item of files) {
      scanned++;

      const publishedAt = new Date(item.date || item.original_date);
      if (publishedAt < TWO_MONTHS_AGO) {
        shouldContinue = false;
        break;
      }

      if (!item.transcoded) continue;

      const videoUrl = await resolveCastusStreamUrl(item._id);
      if (!videoUrl) continue;

      playable++;

      updateSpinner(
        `Scanned ${scanned}, playable ${playable}, page ${page}`
      );

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
