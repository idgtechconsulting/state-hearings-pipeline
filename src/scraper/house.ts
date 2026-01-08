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

const HOUSE_ARCHIVE_URL = "https://www.house.mi.gov/VideoArchive";
const HOUSE_ARCHIVE_YEAR = Number(process.env.HOUSE_ARCHIVE_YEAR || "2025");
const HOUSE_ARCHIVE_TYPE = process.env.HOUSE_ARCHIVE_TYPE || "All";
const HOUSE_ARCHIVE_DATE = process.env.HOUSE_ARCHIVE_DATE || "";
const HOUSE_VIDEO_BASE = "https://www.house.mi.gov/ArchiveVideoFiles";

const HOUSE_INTERMEDIATE_PEM = path.resolve(
  __dirname,
  "../certs/intermediate.pem"
);
const SYSTEM_CA_BUNDLE = "/etc/ssl/cert.pem";

// Combine the system certificate list with the House intermediate certificate
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

// Use a custom HTTPS agent so the House site certificate validates
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  rejectUnauthorized: true,
  ca: getHouseCaBundlePem(),
});

// Work out the cutoff date for recent archives
const TWO_MONTHS_AGO = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  return d;
})();

export async function scrapeHouse(): Promise<HearingVideoMetadata[]> {
  startSpinner("Scanning House videos…");

  // Fetch the archive page using the partial handler endpoint
  const { data } = await axios.get(HOUSE_ARCHIVE_URL, {
    httpsAgent,
    headers: { "User-Agent": "Mozilla/5.0" },
    params: {
      handler: "ArchiveVideoPartial",
      Year: HOUSE_ARCHIVE_YEAR,
      Type: HOUSE_ARCHIVE_TYPE,
      Date: HOUSE_ARCHIVE_DATE,
    },
  });

  // Parse the archive page HTML
  const $ = cheerio.load(data);
  const results: HearingVideoMetadata[] = [];

  let scanned = 0;
  let currentCommittee = "House";

  // The handler response may not include the outer #VideosList wrapper.
  // Prefer #VideosList when present, otherwise fall back to the partial root (#legislativeQuestions),
  // and finally to the document root.
  const $videosRoot =
    $("#VideosList").length > 0
      ? $("#VideosList")
      : $("#legislativeQuestions").length > 0
        ? $("#legislativeQuestions")
        : $("body");

  if ($videosRoot.length === 0) {
    // Cheerio fragments may not include <body>; fall back to the document root element(s)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ($videosRoot as any) = $.root().children() as any;
  }

  // Each committee heading is a <strong> element inside the list
  $videosRoot.find("li.page-search-container strong").each((_, strong) => {
    // Only take the first text node to avoid including the nested "X Videos" span
    currentCommittee = $(strong).contents().first().text().split("|")[0].trim();

    // Grab all video links for the current committee section
    const links = $(strong)
      .closest("li")
      .find("a[href*='VideoArchivePlayer']");

    links.each((_, a) => {
      const href = $(a).attr("href");
      if (!href) return;

      // Pull the video file name from the player link
      const url = new URL(`https://www.house.mi.gov${href}`);
      const videoFile = url.searchParams.get("video");
      if (!videoFile) return;

      // Treat the link text as a date and skip older videos
      const dateText = $(a).text().trim().replace(/\s+/g, " ");
      const publishedAt = new Date(dateText);
      if (isNaN(publishedAt.getTime())) return;
      if (publishedAt < TWO_MONTHS_AGO) return;

      scanned++;
      // Update the progress as we find recent videos
      updateSpinner(`Found ${scanned} recent House videos`);

      // Convert to the standard video shape used by the pipeline
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
