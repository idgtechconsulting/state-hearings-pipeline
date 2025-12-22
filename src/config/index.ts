import dotenv from "dotenv";
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || "development",
  houseArchiveUrl: process.env.HOUSE_ARCHIVE_URL || "",
  senateArchiveUrl: process.env.SENATE_ARCHIVE_URL || "",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  databaseUrl: process.env.DATABASE_URL || ""
};
