// simple S3 client helper
import { S3Client, GetObjectCommand, PutObjectCommand, CreateBucketCommand, PutObjectAclCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

const s3 = new S3Client({
  endpoint: process.env.AWS_S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  },
  forcePathStyle: true,
});

export { s3, GetObjectCommand, PutObjectCommand, HeadObjectCommand };