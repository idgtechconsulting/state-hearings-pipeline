import fs from "fs";
import path from "path";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const region = process.env.AWS_REGION || "us-east-2";
const bucket = process.env.S3_BUCKET;

// Ensure we fail fast if bucket is missing
if (!bucket) throw new Error("Missing env S3_BUCKET");

// Shared S3 client for uploads
export const s3 = new S3Client({ region });

export function makeS3Key(localPath: string, videoId: string) {
  // Create a stable key using the original filename
  // example key: raw/house/HAGRI-102325.mp4 or similar
  const fileName = path.basename(localPath);
  return `videos/${videoId}/${fileName}`;
}

export async function uploadFileToS3(localPath: string, key: string) {
  // Stream the file to keep memory usage low
  const body = fs.createReadStream(localPath);

  // Use multipart upload for large video files
  const uploader = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "video/mp4",
    },
    queueSize: 4, // parallel multipart parts
    partSize: 10 * 1024 * 1024, // 10MB parts
    leavePartsOnError: false,
  });

  // Wait for the upload to complete
  await uploader.done();

  // Return the destination for logging or persistence
  return { bucket, key };
}
