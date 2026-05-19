import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3Client, S3_BUCKET, isS3Configured } from './s3-client'

export { isS3Configured }

export type UploadPhotoResult = { storageKey: string; dbUrl: string }

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
}

export async function uploadPhotoBuffer(args: {
  companyId: string
  serviceOrderId: string
  fileName: string
  contentType: string
  buffer: Buffer
}): Promise<UploadPhotoResult> {
  const { companyId, serviceOrderId, fileName, contentType, buffer } = args
  const safe = sanitizeFileName(fileName)
  const key = `${companyId}/${serviceOrderId}/${Date.now()}_${safe}`

  await getS3Client().send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }))

  return { storageKey: key, dbUrl: `s3://${S3_BUCKET}/${key}` }
}

export function parseS3Url(dbUrl: string): { bucket: string; key: string } | null {
  if (!dbUrl?.startsWith('s3://')) return null
  const m = dbUrl.match(/^s3:\/\/([^/]+)\/(.+)$/)
  if (!m) return null
  return { bucket: m[1], key: m[2] }
}

export function isS3Url(url: string | null | undefined): boolean {
  return !!url && url.startsWith('s3://')
}

export async function signedUrlForS3(dbUrl: string, expiresSec = 600): Promise<string | null> {
  const parsed = parseS3Url(dbUrl)
  if (!parsed) return null
  return await getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
    { expiresIn: expiresSec }
  )
}

export async function deleteS3Object(dbUrl: string): Promise<void> {
  const parsed = parseS3Url(dbUrl)
  if (!parsed) return
  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }))
  } catch {} // best-effort
}
