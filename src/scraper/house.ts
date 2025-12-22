import axios from "axios";
import * as cheerio from "cheerio";
import https from "https";
import { normalizeVideo } from "./normalize";
import type { HearingVideoMetadata } from "../types/video";
import {
  startSpinner,
  updateSpinner,
  succeedSpinner,
} from "../utils/spinner";
import fs from "fs";
import path from "path";

const HOUSE_ARCHIVE_URL = "https://house.mi.gov/VideoArchive";
const HOUSE_VIDEO_BASE = "https://www.house.mi.gov/ArchiveVideoFiles";

const HOUSE_INTERMEDIATE_PEM = path.resolve(__dirname, "../certs/intermediate.pem");
const SYSTEM_CA_BUNDLE = "/etc/ssl/cert.pem";

function getHouseCaBundlePem(): string {
  const intermediatePem = fs.readFileSync(HOUSE_INTERMEDIATE_PEM, "utf8");

  let systemBundle = "";
  try {
    systemBundle = fs.readFileSync(SYSTEM_CA_BUNDLE, "utf8");
  } catch {
    systemBundle = "";
  }

  return `${systemBundle}\n${intermediatePem}\n`;
}

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  rejectUnauthorized: true,
  ca: getHouseCaBundlePem(),
});
const TWO_MONTHS_AGO = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  return d;
})();

export async function scrapeHouse(): Promise<HearingVideoMetadata[]> {
  startSpinner("Scanning House videos…");

  const { data } = await axios.get(HOUSE_ARCHIVE_URL, {
    httpsAgent,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const $ = cheerio.load(data);
  const results: HearingVideoMetadata[] = [];

  let scanned = 0;
  let currentCommittee = "House";

  $("#VideosList strong").each((_, strong) => {
    currentCommittee = $(strong).text().split("|")[0].trim();

    const links = $(strong)
      .closest("li")
      .find("a[href*='VideoArchivePlayer']");

    links.each((_, a) => {
      const href = $(a).attr("href");
      if (!href) return;

      const url = new URL(`https://house.mi.gov${href}`);
      const videoFile = url.searchParams.get("video");
      if (!videoFile) return;

      const dateText = $(a).text().trim();
      const publishedAt = new Date(dateText);
      if (isNaN(publishedAt.getTime())) return;
      if (publishedAt < TWO_MONTHS_AGO) return;

      scanned++;
      updateSpinner(`Found ${scanned} recent House videos`);

      results.push(
        normalizeVideo({
          id: videoFile,
          title: `${currentCommittee} — ${dateText}`,
          url: `${HOUSE_VIDEO_BASE}/${videoFile}`,
          publishedAt,
          chamber: "house",
          duration: null,
        })
      );
    });
  });

  succeedSpinner(`House scrape complete: ${results.length} recent videos`);
  return results;
}
