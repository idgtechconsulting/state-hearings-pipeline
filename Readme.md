# State Hearings Pipeline (Michigan House + Senate)

A production-style ingestion pipeline that **detects newly published Michigan Legislature hearing videos**, **downloads** them, and **transcribes** the audio. Designed to run safely on a schedule (e.g., cron), handle failures gracefully, and **avoid reprocessing** the same video across runs.

This project was built for the **State Affairs Technical Challenge**.

---

## What this system does

On each run, the pipeline:

1. **Scrapes** the Michigan House and Michigan Senate video archives (last ~2 months).
2. **Deduplicates** against previously seen videos (via Postgres).
3. **Enqueues downloads** into a Redis-backed job queue (BullMQ).
4. **Downloads** videos:

   * House videos are downloaded as direct MP4 files (with special TLS handling).
   * Senate videos resolve to **HLS streams** and are downloaded via `ffmpeg`.
5. **Enqueues transcription** jobs for any downloaded videos.
6. **Transcribes** the downloaded file by:

   * extracting mono 16kHz MP3 audio segments via `ffmpeg`
   * calling OpenAI transcription per segment
   * concatenating the output into a final transcript
7. **Persists** transcript + status to Postgres.
8. Optionally **uploads MP4 + transcript to S3**, then cleans up local files.

---

## Key design goals (mapped to challenge requirements)

### ✅ Runs periodically and is safe to invoke multiple times

* Scraper pulls only recent items (last ~2 months).
* Each video has a stable `id` and is stored in Postgres (`HearingVideo.id`).
* Jobs are **idempotent** via BullMQ `jobId = video.id` for both download and transcribe queues.

### ✅ Tracks previously processed videos (no re-download / re-transcribe)

* Download stage checks `videoExists(video.id)` before enqueueing.
* Transcription stage queries only videos with:

  * `localPath != null`
  * `transcript == null`
  * `transcriptStatus is null OR failed`
* Transcription worker skips videos already marked `done` with a transcript present.

### ✅ Handles failures gracefully

* BullMQ retries with exponential backoff for both download and transcription jobs.
* Downloaders clean up partial files on failure.
* Transcriber marks transcript status failed and leaves the MP4 in place for retry.
* Progress and logging provide clear operational visibility.

---

## Architecture

### Components

* **Scrapers**

  * `src/scraper/house.ts` – parses the House archive HTML with Cheerio
  * `src/scraper/senate.ts` – paginates Senate JSON API + resolves playable HLS stream URLs
  * `src/scraper/index.ts` – orchestrates both sources and feature flags

* **Pipeline Orchestration**

  * `src/main.ts` – runs scrape → enqueue downloads → wait → enqueue transcriptions → wait

* **Queues**

  * `src/queue/videoQueue.ts` – BullMQ queue `video-downloads`
  * `src/queue/transcriptionQueue.ts` – BullMQ queue `video-transcriptions`

* **Workers**

  * `src/workers/videoWorker.ts` – downloads the video and inserts metadata in Postgres, then enqueues transcription
  * `src/workers/transcriptionWorker.ts` – transcribes and stores transcript, optional S3 upload

* **Download**

  * `src/downloader/downloadVideo.ts` – MP4 download (supports ranged multipart download for House host)
  * `src/downloader/downloadHls.ts` – HLS download using `ffmpeg`

* **Transcription**

  * `src/transcription/ffmpegSegments.ts` – extracts segmented audio MP3s
  * `src/transcription/openaiTranscribe.ts` – calls OpenAI transcription API
  * `src/transcription/transcribeVideo.ts` – end-to-end transcript generation

* **Storage / DB**

  * Postgres + Prisma
  * `prisma/schema.prisma` defines `HearingVideo`
  * `src/db/videoRepository.ts` and `src/db/transcriptionRepository.ts` encapsulate DB operations
  * Optional S3 upload in `src/storage/s3.ts` (if enabled)

---

## Data model (Postgres via Prisma)

`HearingVideo` is the primary record and idempotency key:

* `id` (String, PK) – stable identifier from archive
* `chamber` – `house` or `senate`
* `title`
* `sourceUrl`
* `localPath` – where the MP4 was downloaded
* `publishedAt`, `duration`
* `downloadedAt`
* `transcript`
* `transcribedAt`
* `transcriptStatus` – `"pending" | "done" | "failed"`

---

## Prerequisites

* **Node.js** (18+ recommended)
* **Postgres** (local or hosted)
* **Redis** (BullMQ backend)
* **ffmpeg** available on PATH (`ffmpeg -version`)
* OpenAI API key (for transcription)

---

## Installation

```bash
npm install
```

Generate Prisma client:

```bash
npx prisma generate
npx prisma migrate dev
```

---

## Configuration

Create a `.env` file in the repo root:

```bash
# Database
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/state_hearings

# Redis
REDIS_URL=redis://127.0.0.1:6379

# OpenAI
OPENAI_API_KEY=your_key
TRANSCRIBE_MODEL=gpt-4o-mini-transcribe

# Senate/House scraping
SENATE_API_URL=https://tf4pr3wftk.execute-api.us-west-2.amazonaws.com/default/api/all
HOUSE_ARCHIVE_URL=https://house.mi.gov/VideoArchive
CASTUS_BASE=https://cloud.castus.tv/vod/misenate

# Feature flags / limits
ENABLE_HOUSE=true
ENABLE_SENATE=true
MAX_VIDEOS_PER_SOURCE=50

# Concurrency
WORKER_CONCURRENCY=3
TRANSCRIBE_CONCURRENCY=2

# Optional S3 upload
ENABLE_S3_UPLOAD=false
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=...

# House download tuning
HOUSE_DOWNLOAD_PARTS=6
DOWNLOAD_PROGRESS_EVERY_MS=250

# ⚠️ Only if absolutely necessary (not recommended):
ALLOW_INSECURE_HOUSE_TLS=false

# Logging
LOG_LEVEL=info
NODE_ENV=development
```

> Note: `SENATE_API_URL` is required to paginate Senate results.

---

## Running locally

### 1) Start Redis + Postgres

Example with Docker:

```bash
docker run -p 6379:6379 redis:7
docker run -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
```

### 2) Run everything (pipeline + both workers)

This starts:

* download worker
* transcription worker
* pipeline runner

```bash
npm run start:all
```

### 3) Run components separately

Workers:

```bash
npm run worker:video
npm run worker:transcribe
```

Pipeline runner (one-shot):

```bash
npm run dev
```

---

## Scheduling (cron)

The pipeline (`src/main.ts`) is designed to be executed periodically. A typical pattern is:

* Keep **workers running continuously** (systemd / pm2 / Docker)
* Run the **pipeline** on a schedule to enqueue work

Example cron entry (every 15 minutes):

```cron
*/15 * * * * cd /path/to/state-hearings-pipeline && /usr/local/bin/npm run dev >> /var/log/hearings-pipeline.log 2>&1
```

---

## Idempotency & recovery behavior

### Deduplication

* The DB primary key is `HearingVideo.id`.
* Queue jobs use `jobId = video.id`, so duplicates collapse automatically.

### Download stage

* If the file already exists locally and is non-empty, the worker skips downloading and continues downstream.
* Partial artifacts are cleaned up on download errors.

### Transcription stage

* Transcription only runs when:

  * `localPath` is present
  * `transcript` is missing
  * `transcriptStatus` is null or failed
* On failure, status is set to `failed` and job is retried by BullMQ.
* On success, transcript is saved and status set to `done`.

---

## Operational visibility

* Logging: `pino` with `pino-pretty` in development.
* CLI progress:

  * scrape/download/transcribe stage bars (`src/utils/pipelineProgress.ts`)
  * queue drain progress (`src/utils/waitForQueueIdle.ts`)
  * per-download progress events via BullMQ `job.updateProgress`

---

## TLS / Certificate Handling (Michigan House)

The Michigan House video host (`www.house.mi.gov`) can present certificate-chain issues in some environments (especially on fresh machines, CI runners, or minimal containers) where the OS trust store may not include the needed intermediate certificate(s). To make downloads reliable **without disabling TLS verification**, this project supports bundling an intermediate certificate and explicitly supplying it to Node’s HTTPS client.

### What’s in `src/certs/intermediate.pem`?

`src/certs/intermediate.pem` contains the **intermediate certificate** required to complete the trust chain for the House download host in certain setups.

### How it’s used

The MP4 downloader (`src/downloader/downloadVideo.ts`) builds a CA bundle at runtime by concatenating:

* the system trust store (when available), plus
* `src/certs/intermediate.pem`

That combined CA bundle is passed to a dedicated `https.Agent` used **only** for requests to `www.house.mi.gov`. This keeps TLS verification enabled while improving compatibility across machines.

### Recommended behavior (default)

By default:

* TLS verification remains **ON**
* the custom CA bundle is applied only for the House host

### Emergency fallback (not recommended)

If you are in a constrained environment and absolutely must bypass verification, you can set:

```bash
ALLOW_INSECURE_HOUSE_TLS=true
```

This is intentionally discouraged and should only be used as a last resort for development/debugging—**never for production**. The secure, preferred path is to rely on the bundled intermediate certificate.

## Known limitations (acceptable for challenge scope)

* Scraping window is intentionally limited to ~2 months to avoid historical backfill.
* Senate stream URL resolution depends on the Castus resolver endpoint used in `resolveCastusStreamUrl`.
* Transcription is sequential per audio segment (can be parallelized if needed).
* House scraping currently fetches HTML and parses DOM structure; changes to the website may require selector updates.

---

## Directory overview

```
src/
  scraper/                # House + Senate discovery
  downloader/             # MP4 + HLS download logic
  queue/                  # BullMQ queues (Redis)
  workers/                # Download + transcription worker processes
  transcription/          # ffmpeg segmentation + OpenAI transcription
  db/                     # Prisma client + repositories
  storage/                # Optional S3 upload
  utils/                  # logging, progress, queue drain visualization
prisma/
  schema.prisma           # HearingVideo model
data/
  videos/                 # downloaded videos (if not deleted post-transcribe)
```

---

## Future improvements (post-challenge)

* Add a proper “pipeline run id” and structured metrics (Prometheus / OpenTelemetry).
* Use Prisma `upsert` / unique-constraint safe inserts to remove race windows.
* Parallelize transcription per segment with concurrency limits.
* Add better normalization for titles/committees and consistent naming.
* Add unit tests for scrapers and repository logic.
* Package workers + pipeline into containers + compose file.

---

## License

For challenge submission / evaluation.
