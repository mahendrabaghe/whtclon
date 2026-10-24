import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI = 'mongodb://127.0.0.1/connectx';
process.env.JWT_SECRET = 'test-only-secret-with-more-than-32-characters';
process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-api-key';
process.env.CLOUDINARY_API_SECRET = 'test-api-secret';

const [{ v2: cloudinary }, uploads] = await Promise.all([
  import('cloudinary'),
  import('../server/uploads.js')
]);

test('attachment and profile lookups use Cloudinary promises and handle missing pending assets', async (t) => {
  const originalResource = cloudinary.api.resource;
  const originalRename = cloudinary.uploader.rename;
  const lookups = [];
  const renames = [];
  cloudinary.api.resource = async (publicId, options) => {
    lookups.push([publicId, options]);
    if (publicId.startsWith('pending_chat_')) {
      throw Object.assign(new Error('Not found'), { http_code: 404 });
    }
    const profileImage = options.resource_type === 'image';
    return {
      bytes: profileImage ? 4 : 3,
      format: profileImage ? 'png' : 'pdf',
      resource_type: options.resource_type,
      type: 'authenticated',
      context: { custom: { content_type: profileImage ? 'image/png' : 'application/pdf' } }
    };
  };
  cloudinary.uploader.rename = async (fromPublicId, toPublicId, options) => {
    renames.push([fromPublicId, toPublicId, options]);
    return {};
  };
  t.after(() => {
    cloudinary.api.resource = originalResource;
    cloudinary.uploader.rename = originalRename;
  });

  assert.equal(uploads.isStorageConfigured(), true);
  const conversationId = '507f1f77bcf86cd799439011';
  const userId = '507f1f77bcf86cd799439012';
  const attachmentId = '550e8400-e29b-41d4-a716-446655440000';
  const attachmentKey = await uploads.storeUploadedAttachment({
    conversationId, userId, attachmentId, contentType: 'application/pdf', size: 3
  });
  assert.equal(
    attachmentKey,
    `raw/attachment_${conversationId}_${userId}_${attachmentId}.pdf`
  );

  const avatarKey = await uploads.completeProfileImageUpload({
    key: `image/pending_avatar_${userId}_${attachmentId}`,
    userId, contentType: 'image/png', size: 4
  });
  assert.equal(avatarKey, `image/avatar_${userId}_${attachmentId}`);
  assert.equal(lookups.length, 3);
  for (const [, options] of lookups) {
    assert.equal(options.type, 'authenticated');
  }
  assert.equal(lookups[0][1].resource_type, 'raw');
  assert.equal(lookups[1][1].resource_type, 'raw');
  assert.equal(lookups[2][1].resource_type, 'image');
  assert.equal(renames.length, 1);
  assert.equal(renames[0][2].type, 'authenticated');
});
