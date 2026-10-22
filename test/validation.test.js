import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedAttachmentTypes, sanitizeFileName } from '../server/validation.js';

test('accepts only the configured attachment MIME types', () => {
  assert.equal(allowedAttachmentTypes.has('image/png'), true);
  assert.equal(allowedAttachmentTypes.has('application/pdf'), true);
  assert.equal(allowedAttachmentTypes.has('image/svg+xml'), false);
  assert.equal(allowedAttachmentTypes.has('text/html'), false);
  assert.equal(allowedAttachmentTypes.has('application/javascript'), false);
});

test('sanitizes file names and caps their length', () => {
  assert.equal(sanitizeFileName('..\\folder/file.pdf'), '.._folder_file.pdf');
  assert.equal(sanitizeFileName('report\u0000.pdf'), 'report_.pdf');
  assert.equal(sanitizeFileName('   '), '');
  assert.equal(sanitizeFileName('x'.repeat(200)).length, 180);
  assert.equal(sanitizeFileName(`${'x'.repeat(179)}😀`).length, 179);
  assert.equal(sanitizeFileName(null), '');
});
