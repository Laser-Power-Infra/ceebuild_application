import 'server-only';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

// S3 reads credentials from the environment only (no fallback secrets).
// Without S3_ACCESS_KEY/S3_SECRET_KEY uploads are refused and archiving is skipped.

const env = process.env;
export const S3_BUCKET = env.S3_BUCKET || 'ceebuild-docket';
export const s3Configured = !!(env.S3_ACCESS_KEY && env.S3_SECRET_KEY);

const client = s3Configured
  ? new S3Client({
      endpoint: env.S3_ENDPOINT_URL || 'http://192.168.1.190:8500',
      region: env.S3_REGION || 'us-east-1',
      credentials: { accessKeyId: env.S3_ACCESS_KEY as string, secretAccessKey: env.S3_SECRET_KEY as string },
      forcePathStyle: true,
    })
  : null;

export const cleanFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

/** Stores the file and returns its key, or null when S3 is not configured. Upload errors propagate. */
export async function archiveFile(prefix: string, fileName: string, body: Buffer, contentType: string): Promise<string | null> {
  if (!client) return null;
  const key = `${prefix}/${Date.now().toString(36)}_${cleanFileName(fileName)}`;
  await client.send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType || 'application/octet-stream' }),
  );
  return key;
}

/** Uploads under an exact key. Throws when S3 is not configured. */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  if (!client) throw new Error('File storage is not configured (S3_ACCESS_KEY / S3_SECRET_KEY missing).');
  await client.send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType || 'application/octet-stream' }),
  );
}

/** Reads an object; returns null when it has no body. Throws when S3 is not configured. */
export async function getObject(key: string): Promise<{ body: Uint8Array; contentType: string } | null> {
  if (!client) throw new Error('File storage is not configured (S3_ACCESS_KEY / S3_SECRET_KEY missing).');
  const res = await client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  if (!res.Body) return null;
  return { body: await res.Body.transformToByteArray(), contentType: res.ContentType || 'application/octet-stream' };
}
