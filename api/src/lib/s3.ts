import { S3Client } from '@aws-sdk/client-s3';

const endpoint = process.env.BUCKET_ENDPOINT;
const accessKeyId = process.env.BUCKET_ACCESS_KEY;
const secretAccessKey = process.env.BUCKET_SECRET_KEY;

export const bucketName = process.env.BUCKET_NAME ?? 'campaign-assets';
export const bucketPublicBaseUrl =
  process.env.BUCKET_PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? null;

export const s3Configured = Boolean(endpoint && accessKeyId && secretAccessKey);

export const s3 = s3Configured
  ? new S3Client({
      endpoint,
      region: process.env.BUCKET_REGION ?? 'us-east-1',
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      forcePathStyle: true,
    })
  : null;

export function publicUrlFor(path: string): string | null {
  if (bucketPublicBaseUrl) {
    return `${bucketPublicBaseUrl}/${path}`;
  }
  if (!endpoint) return null;
  const base = endpoint.replace(/\/+$/, '');
  return `${base}/${bucketName}/${path}`;
}
