import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { config } from './config.js';

const storageConfigured = Boolean(config.cloudinaryCloudName);
if (storageConfigured) {
  cloudinary.config({
    cloud_name: config.cloudinaryCloudName,
    api_key: config.cloudinaryApiKey,
    api_secret: config.cloudinaryApiSecret,
    secure: true
  });
}

export const isStorageConfigured = () => storageConfigured;

const fileFormats = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/gif', 'gif'], ['image/webp', 'webp'],
  ['video/mp4', 'mp4'], ['video/webm', 'webm'],
  ['application/pdf', 'pdf'], ['text/plain', 'txt'], ['text/csv', 'csv'],
  ['application/msword', 'doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.ms-excel', 'xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.ms-powerpoint', 'ppt'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/zip', 'zip']
]);

function resourceTypeFor(contentType) {
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  return 'raw';
}

function makeKey(resourceType, publicId) {
  return `${resourceType}/${publicId}`;
}

function assetFromKey(key) {
  const match = /^(image|video|raw)\/([a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9]+)?)$/.exec(key || '');
  if (!match) {
    const error = new Error('Stored upload identifier is invalid.');
    error.status = 400;
    throw error;
  }
  return { resourceType: match[1], publicId: match[2] };
}

function uploadParameters(publicId, contentType) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    timestamp,
    public_id: publicId,
    type: 'authenticated',
    overwrite: false,
    context: `content_type=${contentType}`
  };
}

function signedUpload(resourceType, publicId, contentType) {
  const params = uploadParameters(publicId, contentType);
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudinaryCloudName)}/${resourceType}/upload`,
    fields: {
      ...params,
      api_key: config.cloudinaryApiKey,
      signature: cloudinary.utils.api_sign_request(params, config.cloudinaryApiSecret)
    },
    expiresIn: 3600
  };
}

export async function createUploadUrl({ conversationId, userId, contentType, size }) {
  if (!storageConfigured) throw new Error('Cloudinary storage is not configured.');
  const attachmentId = crypto.randomUUID();
  const resourceType = resourceTypeFor(contentType);
  const extension = resourceType === 'raw' ? `.${fileFormats.get(contentType)}` : '';
  const publicId = `pending_chat_${conversationId}_${userId}_${attachmentId}${extension}`;
  const upload = signedUpload(resourceType, publicId, contentType);
  return {
    attachmentId,
    uploadUrl: upload.uploadUrl,
    fields: upload.fields,
    expiresIn: upload.expiresIn
  };
}

export async function createProfileImageUploadUrl({ userId, contentType, size }) {
  if (!storageConfigured) throw new Error('Profile picture uploads require Cloudinary configuration.');
  const publicId = `pending_avatar_${userId}_${crypto.randomUUID()}`;
  const upload = signedUpload('image', publicId, contentType);
  return {
    key: makeKey('image', publicId),
    uploadUrl: upload.uploadUrl,
    fields: upload.fields,
    expiresIn: upload.expiresIn
  };
}

export async function completeProfileImageUpload({ key, userId, contentType, size }) {
  if (!storageConfigured) throw new Error('Profile picture uploads require Cloudinary configuration.');
  const asset = assetFromKey(key);
  const keyPattern = new RegExp(`^pending_avatar_${userId}_([a-f\\d-]{36})$`, 'i');
  const match = keyPattern.exec(asset.publicId);
  if (asset.resourceType !== 'image' || !match) {
    const error = new Error('Profile picture upload is invalid or expired.');
    error.status = 400;
    throw error;
  }
  await verifyAsset(asset, { contentType, size });
  const storedKey = makeKey('image', `avatar_${userId}_${match[1]}`);
  await cloudinary.uploader.rename(asset.publicId, assetFromKey(storedKey).publicId, undefined, {
    resource_type: 'image', type: 'authenticated', to_type: 'authenticated',
    overwrite: false, invalidate: true
  });
  return storedKey;
}

function attachmentKey({ conversationId, userId, attachmentId, contentType, pending = false }) {
  const extension = fileFormats.get(contentType);
  const resourceType = resourceTypeFor(contentType);
  const suffix = resourceType === 'raw' ? `.${extension}` : '';
  const prefix = pending ? 'pending_chat' : 'attachment';
  return makeKey(resourceType, `${prefix}_${conversationId}_${userId}_${attachmentId}${suffix}`);
}

async function findAsset({ resourceType, publicId }) {
  try {
    return await cloudinary.api.resource(publicId, { resource_type: resourceType, type: 'authenticated' });
  } catch (error) {
    if (error.http_code === 404) return null;
    throw error;
  }
}

function validateAsset(result, { resourceType, contentType, size }) {
  const expectedFormat = fileFormats.get(contentType);
  if (result.bytes !== size || result.format !== expectedFormat ||
      result.resource_type !== resourceType || result.type !== 'authenticated' ||
      result.context?.custom?.content_type !== contentType) {
    const error = new Error('The uploaded file did not pass validation.');
    error.status = 400;
    throw error;
  }
}

async function verifyAsset(asset, details) {
  const result = await findAsset(asset);
  if (!result) {
    const error = new Error('The uploaded file is invalid or expired.');
    error.status = 400;
    throw error;
  }
  validateAsset(result, { ...details, resourceType: asset.resourceType });
  return result;
}

export async function storeUploadedAttachment({ conversationId, userId, attachmentId, contentType, size }) {
  if (!storageConfigured) throw new Error('Cloudinary storage is not configured.');
  const pendingKey = attachmentKey({ conversationId, userId, attachmentId, contentType, pending: true });
  const storedKey = attachmentKey({ conversationId, userId, attachmentId, contentType });
  const pending = assetFromKey(pendingKey);
  const stored = assetFromKey(storedKey);
  const pendingResult = await findAsset(pending);
  if (pendingResult) {
    validateAsset(pendingResult, { resourceType: pending.resourceType, contentType, size });
    try {
      await cloudinary.uploader.rename(pending.publicId, stored.publicId, undefined, {
        resource_type: pending.resourceType, type: 'authenticated', to_type: 'authenticated',
        overwrite: false, invalidate: true
      });
    } catch (error) {
      if (error.http_code !== 409) throw error;
      await verifyAsset(stored, { contentType, size });
      await cloudinary.uploader.destroy(pending.publicId, {
        resource_type: pending.resourceType, type: 'authenticated', invalidate: true
      });
    }
  } else {
    await verifyAsset(stored, { contentType, size });
  }
  return storedKey;
}

export async function createDownloadUrl({ key, fileName, contentType, download = false }) {
  if (!storageConfigured) throw new Error('Cloudinary storage is not configured.');
  const asset = assetFromKey(key);
  const format = fileFormats.get(contentType);
  if (!format) throw new Error('Stored upload content type is invalid.');
  return cloudinary.utils.private_download_url(asset.publicId, format, {
    resource_type: asset.resourceType,
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + 300,
    attachment: download
  });
}

export async function deleteStoredAttachments(keys) {
  if (!storageConfigured) throw new Error('Cloudinary storage is not configured.');
  await Promise.all([...new Set(keys)].map(async (key) => {
    const asset = assetFromKey(key);
    const result = await cloudinary.uploader.destroy(asset.publicId, {
      resource_type: asset.resourceType, type: 'authenticated', invalidate: true
    });
    if (!['ok', 'not found'].includes(result.result)) {
      throw new Error(`Cloudinary could not delete an uploaded asset (${result.result}).`);
    }
  }));
}
