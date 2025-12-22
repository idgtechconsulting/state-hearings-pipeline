import fs from "fs";
import path from "path";
import axios from "axios";
import https from "https";
import { pipeline } from "stream/promises";
import { logger } from "../utils/logger";

const HOUSE_HOST = "www.house.mi.gov";
const HOUSE_INTERMEDIATE_PEM = path.resolve(__dirname, "../certs/intermediate.pem");
const SYSTEM_CA_BUNDLE = "/etc/ssl/cert.pem";

const DEFAULT_PARTS = Math.max(1, Math.min(16, Number(process.env.HOUSE_DOWNLOAD_PARTS || "6")));

// Progress update throttle (ms)
const PROGRESS_EVERY_MS = Number(process.env.DOWNLOAD_PROGRESS_EVERY_MS || "250");

type DownloadProgress = {
  downloadedBytes: number;
  totalBytes?: number;
  bps?: number; // bytes/sec
};

type DownloadVideoOptions = {
  onProgress?: (p: DownloadProgress) => void;
};

let cachedHouseCa: string | null = null;
function getHouseCaBundlePem(): string {
  if (cachedHouseCa) return cachedHouseCa;

  const intermediatePem = fs.readFileSync(HOUSE_INTERMEDIATE_PEM, "utf8");

  let systemBundle = "";
  try {
    systemBundle = fs.readFileSync(SYSTEM_CA_BUNDLE, "utf8");
  } catch {
    systemBundle = "";
  }

  cachedHouseCa = `${systemBundle}\n${intermediatePem}\n`;
  return cachedHouseCa;
}

let cachedHouseAgent: https.Agent | null = null;
let cachedDefaultAgent: https.Agent | null = null;

function getHttpsAgentForUrl(url: string): https.Agent {
  const host = new URL(url).host;

  const allowInsecure =
    process.env.ALLOW_INSECURE_HOUSE_TLS === "true" && host === HOUSE_HOST;

  if (host === HOUSE_HOST && !allowInsecure) {
    if (!cachedHouseAgent) {
      cachedHouseAgent = new https.Agent({
        keepAlive: true,
        maxSockets: 128,
        maxFreeSockets: 64,
        rejectUnauthorized: true,
        ca: getHouseCaBundlePem(),
      });
    }
    return cachedHouseAgent;
  }

  if (!cachedDefaultAgent) {
    cachedDefaultAgent = new https.Agent({
      keepAlive: true,
      maxSockets: 128,
      maxFreeSockets: 64,
      rejectUnauthorized: !allowInsecure,
    });
  }
  return cachedDefaultAgent;
}

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.house.mi.gov/",
  Connection: "keep-alive",
};

async function headInfo(url: string, agent: https.Agent) {
  const res = await axios.head(url, {
    timeout: 30_000,
    maxRedirects: 5,
    headers,
    httpsAgent: agent,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  const len = Number(res.headers["content-length"] || 0);
  const acceptRanges = String(res.headers["accept-ranges"] || "")
    .toLowerCase()
    .includes("bytes");

  return { contentLength: len, acceptRanges };
}

function makeProgressEmitter(onProgress?: (p: DownloadProgress) => void, totalBytes?: number) {
  let downloadedBytes = 0;
  let lastEmit = 0;

  let lastBytes = 0;
  let lastTime = Date.now();

  function addBytes(n: number) {
    downloadedBytes += n;
    const now = Date.now();

    if (!onProgress) return;

    if (now - lastEmit >= PROGRESS_EVERY_MS) {
      const dt = (now - lastTime) / 1000;
      const db = downloadedBytes - lastBytes;
      const bps = dt > 0 ? db / dt : undefined;

      onProgress({ downloadedBytes, totalBytes, bps });

      lastEmit = now;
      lastBytes = downloadedBytes;
      lastTime = now;
    }
  }

  function flush() {
    if (!onProgress) return;
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    const db = downloadedBytes - lastBytes;
    const bps = dt > 0 ? db / dt : undefined;
    onProgress({ downloadedBytes, totalBytes, bps });
  }

  return { addBytes, flush, getDownloaded: () => downloadedBytes };
}

async function downloadSingle(
  url: string,
  tmpPath: string,
  agent: https.Agent,
  opts: DownloadVideoOptions,
  totalBytes?: number
) {
  const emitter = makeProgressEmitter(opts.onProgress, totalBytes);

  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 0,
    maxRedirects: 5,
    headers,
    httpsAgent: agent,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  res.data.on("data", (chunk: Buffer) => emitter.addBytes(chunk.length));

  await pipeline(res.data, fs.createWriteStream(tmpPath, { highWaterMark: 1024 * 1024 }));
  emitter.flush();
}

async function downloadRanged(
  url: string,
  tmpPath: string,
  agent: https.Agent,
  parts: number,
  opts: DownloadVideoOptions
) {
  const { contentLength, acceptRanges } = await headInfo(url, agent);

  // If the server doesn't support ranges or we don't know size, fallback
  if (!acceptRanges || !contentLength || parts <= 1) {
    return downloadSingle(url, tmpPath, agent, opts, contentLength || undefined);
  }

  const emitter = makeProgressEmitter(opts.onProgress, contentLength);

  const partsDir = `${tmpPath}.parts`;
  await fs.promises.mkdir(partsDir, { recursive: true });

  const chunkSize = Math.ceil(contentLength / parts);
  const partFiles = Array.from({ length: parts }, (_, i) => path.join(partsDir, `part-${i}`));

  await Promise.all(
    partFiles.map(async (file, i) => {
      const start = i * chunkSize;
      const end = Math.min(contentLength - 1, (i + 1) * chunkSize - 1);
      if (start > end) return;

      const res = await axios.get(url, {
        responseType: "stream",
        timeout: 0,
        maxRedirects: 5,
        headers: { ...headers, Range: `bytes=${start}-${end}` },
        httpsAgent: agent,
        validateStatus: (s) => s === 206 || (s >= 200 && s < 300),
      });

      res.data.on("data", (chunk: Buffer) => emitter.addBytes(chunk.length));

      await pipeline(res.data, fs.createWriteStream(file, { highWaterMark: 1024 * 1024 }));
    })
  );

  // stitch
  const out = fs.createWriteStream(tmpPath, { highWaterMark: 1024 * 1024 });

  for (const f of partFiles) {
    await new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream(f, { highWaterMark: 1024 * 1024 });
      rs.on("error", reject);
      rs.on("end", resolve);
      rs.pipe(out, { end: false });
    });
  }

  out.end();
  await new Promise<void>((resolve, reject) => {
    out.on("finish", resolve);
    out.on("error", reject);
  });

  emitter.flush();

  await fs.promises.rm(partsDir, { recursive: true, force: true });

  return { totalBytes: contentLength, downloadedBytes: emitter.getDownloaded() };
}

export async function downloadVideo(
  url: string,
  localPath: string,
  label: string,
  opts: DownloadVideoOptions = {}
): Promise<void> {
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });

  const tmpPath = `${localPath}.part`;
  const agent = getHttpsAgentForUrl(url);

  // Only use ranged/multipart for the MI House host; others default to single-stream.
  const host = new URL(url).host;
  const parts = host === HOUSE_HOST ? DEFAULT_PARTS : 1;

  logger.info(`[${label}] Starting MP4 download (parts=${parts})`);

  try {
    await downloadRanged(url, tmpPath, agent, parts, opts);

    await fs.promises.rename(tmpPath, localPath);
    logger.info(`[${label}] Download completed`);
  } catch (err: any) {
    try {
      await fs.promises.rm(tmpPath, { force: true });
      await fs.promises.rm(`${tmpPath}.parts`, { recursive: true, force: true });
    } catch {}

    const msg = err?.message || String(err);
    if (
      msg.includes("unable to verify the first certificate") ||
      msg.includes("unable to get issuer certificate")
    ) {
      logger.error(
        `[${label}] TLS verification failed for ${url}. ` +
          `Using ${SYSTEM_CA_BUNDLE} + ${HOUSE_INTERMEDIATE_PEM}. ` +
          `If absolutely necessary, set ALLOW_INSECURE_HOUSE_TLS=true for ${HOUSE_HOST} only.`
      );
    }

    throw err;
  }
}
