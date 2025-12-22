import { scrapeHouse } from "./house";
import { scrapeSenate } from "./senate";
import { HearingVideoMetadata } from "../types/video";
import { logger } from "../utils/logger";

export async function scrapeAll(): Promise<HearingVideoMetadata[]> {
  const results: HearingVideoMetadata[] = [];

  const MAX_PER_SOURCE = Number(process.env.MAX_VIDEOS_PER_SOURCE || Infinity);
  const ENABLE_HOUSE = process.env.ENABLE_HOUSE !== "false";
  const ENABLE_SENATE = process.env.ENABLE_SENATE !== "false";
  // process.env.ENABLE_SENATE !== "false";

  if (ENABLE_HOUSE) {
    logger.info("House scraping ENABLED");
    logger.info("Scraping House videos");
    const house = await scrapeHouse();
    results.push(...house.slice(0, MAX_PER_SOURCE));
  } else {
    logger.info("House scraping DISABLED");
  }

  if (ENABLE_SENATE) {
    logger.info("Senate scraping ENABLED");
    logger.info("Scraping Senate videos");
    const senate = await scrapeSenate();
    results.push(...senate.slice(0, MAX_PER_SOURCE));
  } else {
    logger.info("Senate scraping DISABLED");
  }
  return results;
}
