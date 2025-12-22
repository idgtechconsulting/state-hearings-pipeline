import fs from "fs";
import path from "path";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const region = process.env.AWS_REGION || "us-east-2";
const bucket = process.env.S3_BUCKET;

if (!bucket) throw new Error("Missing env S3_BUCKET");

export const s3 = new S3Client({ region });

export function makeS3Key(localPath: string, videoId: string) {
  // example key: raw/house/HAGRI-102325.mp4 or similar
  const fileName = path.basename(localPath);
  return `videos/${videoId}/${fileName}`;
}

export async function uploadFileToS3(localPath: string, key: string) {
  const body = fs.createReadStream(localPath);

  const uploader = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "video/mp4",
    },
    queueSize: 4,      // parallel multipart parts
    partSize: 10 * 1024 * 1024, // 10MB parts
    leavePartsOnError: false,
  });

  await uploader.done();

  return { bucket, key };
}
