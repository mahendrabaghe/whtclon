import crypto from 'node:crypto';
import { S3Client, CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

const storageConfigured = Boolean(config.r2AccountId);
const client = storageConfigured ? new S3Client({
  region: 'auto',
  endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey }
}) : null;
const bucket = config.r2BucketName;

export const isStorageConfigured = () => storageConfigured;

export async function createUploadUrl({ conversationId, userId, contentType, size }) {
  if (!client) throw new Error('Cloudflare R2 storage is not configured.');
  const attachmentId = crypto.randomUUID();
  const key = `pending/${conversationId}/${userId}/${attachmentId}`;
  const headers = { 'Content-Type': contentType };
  const command = new PutObjectCommand({
    Bucket: bucket, Key: key, ContentType: contentType, ContentLength: size
  });
  return {
    attachmentId,
    uploadUrl: await getSignedUrl(client, command, {
      expiresIn: 300, signableHeaders: new Set(['content-type'])
    }),
    headers,
    expiresIn: 300
  };
}

function attachmentKeys({ conversationId, userId, attachmentId }) {
  // The key binds every upload to its authenticated owner and conversation.
  return {
    pending: `pending/${conversationId}/${userId}/${attachmentId}`,
    stored: `attachments/${conversationId}/${userId}/${attachmentId}`
  };
}

async function getVerifiedObject(key, { contentType, size }) {
  const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (result.ContentLength !== size || result.ContentType !== contentType) {
    const error = new Error('The uploaded file did not pass validation.');
    error.status = 400;
    throw error;
  }
  return result;
}

export async function storeUploadedAttachment({ conversationId, userId, attachmentId, contentType, size }) {
  if (!client) throw new Error('Cloudflare R2 storage is not configured.');
  const { pending, stored } = attachmentKeys({ conversationId, userId, attachmentId });
  try {
    await getVerifiedObject(pending, { contentType, size });
    const copySource = `${bucket}/${pending.split('/').map(encodeURIComponent).join('/')}`;
    await client.send(new CopyObjectCommand({
      Bucket: bucket, Key: stored, CopySource: copySource
    }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: pending }));
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 404) throw error;
    await getVerifiedObject(stored, { contentType, size });
  }
  return stored;
}

export async function createDownloadUrl({ key, fileName, contentType, download = false }) {
  if (!client) throw new Error('Cloudflare R2 storage is not configured.');
  const safeAsciiName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const disposition = !download && (contentType.startsWith('image/') || contentType.startsWith('video/'))
    ? `inline; filename="${safeAsciiName}"`
    : `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  return getSignedUrl(client, new GetObjectCommand({
    Bucket: bucket, Key: key, ResponseContentType: contentType,
    ResponseContentDisposition: disposition
  }), { expiresIn: 300 });
}

export async function deleteStoredAttachments(keys) {
  if (!client) throw new Error('Cloudflare R2 storage is not configured.');
  await Promise.all([...new Set(keys)].map((key) =>
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  ));
}
