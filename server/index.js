import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { config } from './config.js';
import { api } from './routes.js';
import { configureSocket } from './socket.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", ...config.origins, 'wss:', 'https:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.origins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '16kb', strict: true }));
app.use('/api', api);
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((error, _req, res, _next) => {
  if (error.message === 'Origin is not allowed by CORS.') return res.status(403).json({ error: error.message });
  console.error(`Request failed (${error.name || 'Error'}).`);
  if (error.name === 'ValidationError' || error.name === 'CastError' || error.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Request data is invalid or too large.' });
  }
  return res.status(error.status || 500).json({ error: error.status ? error.message : 'An unexpected server error occurred.' });
});

try {
  await mongoose.connect(config.mongoUri);
} catch (error) {
  console.error(`MongoDB connection failed (${error.name || 'Error'}). Check the configured database and network access.`);
  process.exit(1);
}
mongoose.connection.on('error', (error) => console.error(`MongoDB connection error (${error.name || 'Error'}).`));
const server = http.createServer(app);
const io = configureSocket(server);
server.listen(config.port, () => console.log(`ConnectX server listening on port ${config.port}`));

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  io.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
