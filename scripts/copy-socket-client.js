import { copyFileSync, mkdirSync } from 'node:fs';

const target = new URL('../public/vendor/', import.meta.url);
mkdirSync(target, { recursive: true });
copyFileSync(
  new URL('../node_modules/socket.io-client/dist/socket.io.min.js', import.meta.url),
  new URL('socket.io.min.js', target)
);
copyFileSync(
  new URL('../node_modules/socket.io-client/LICENSE', import.meta.url),
  new URL('LICENSE.socket.io-client', target)
);
