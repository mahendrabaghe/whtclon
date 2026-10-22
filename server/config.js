import 'dotenv/config';

const required = ['MONGODB_URI', 'JWT_SECRET'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters.');
}

const numeric = (name, fallback, min, max) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
};

const cloudinaryValues = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const configuredCloudinaryValues = cloudinaryValues.filter((name) => process.env[name]);
if (configuredCloudinaryValues.length && configuredCloudinaryValues.length !== cloudinaryValues.length) {
  throw new Error(`Set all Cloudinary variables together: ${cloudinaryValues.join(', ')}.`);
}

export const config = Object.freeze({
  port: numeric('PORT', 3000, 1, 65535),
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  origins: (process.env.FRONTEND_ORIGINS || 'http://localhost:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
  invitationTtlHours: numeric('INVITATION_TTL_HOURS', 72, 1, 720),
  maxMessageLength: numeric('MAX_MESSAGE_LENGTH', 4000, 1, 20000),
  turnUrls: (process.env.TURN_URLS || '').split(',').map((url) => url.trim()).filter(Boolean),
  turnSecret: process.env.TURN_SECRET || '',
  turnCredentialTtlSeconds: numeric('TURN_CREDENTIAL_TTL_SECONDS', 3600, 60, 86400),
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || '',
  maxUploadSizeBytes: numeric('MAX_UPLOAD_SIZE_BYTES', 26214400, 1, 26214400)
});
if (config.turnUrls.some((url) => !/^turns?:/i.test(url))) {
  throw new Error('TURN_URLS entries must use the turn: or turns: scheme.');
}
