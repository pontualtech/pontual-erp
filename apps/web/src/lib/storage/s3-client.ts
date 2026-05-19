import { S3Client } from '@aws-sdk/client-s3'

let _client: S3Client | null = null

export function getS3Client(): S3Client {
  if (_client) return _client

  const endpoint = process.env.S3_ENDPOINT
  const accessKeyId = process.env.S3_ACCESS_KEY
  const secretAccessKey = process.env.S3_SECRET_KEY

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3 not configured. Required envs: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY'
    )
  }

  _client = new S3Client({
    endpoint,
    region: process.env.S3_REGION || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // MinIO + paths /bucket/key (não virtual host)
  })
  return _client
}

export const S3_BUCKET = process.env.S3_BUCKET || 'os-photos'

export function isS3Configured(): boolean {
  return !!(process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY)
}
