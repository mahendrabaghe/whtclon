# ConnectX

ConnectX is a small, full-stack, one-to-one chat and WebRTC calling application. The browser client is plain HTML, CSS, and vanilla JavaScript modules, served by an Express API that uses Socket.IO and MongoDB.

## Implemented

- Email/password registration and email-or-username login (bcrypt hashes, signed JWTs in persistent HttpOnly cookies; bearer-token clients remain supported)
- Private one-to-one invitations with random 256-bit tokens stored as SHA-256 hashes, expiry, and creator revocation
- Authenticated conversation membership checks for REST and Socket.IO actions
- Persistent text messages, history pagination, typing indicators, unread counts, read receipts, and author-only message deletion
- Per-user chat clearing that hides history from the requesting participant without deleting messages or affecting other participants
- Presence updates, profile display-name/about/avatar editing, and conversation search
- Optional JPEG/PNG/WebP avatar uploads through Cloudinary authenticated assets, alongside existing HTTPS avatar URLs
- Audio/video WebRTC calls with accept/reject/end, mic/camera toggles, camera switching, call duration, and TURN credential generation for coturn-compatible providers
- Private file sharing through Cloudinary authenticated uploads/downloads, with membership checks, Android file-picker MIME fallback by supported extension, upload progress, previews, and a 25 MB default file limit
- Security headers, CORS allow-list, request size limits, authentication rate limits, and socket message throttling

File and profile-image uploads require external provider configuration and may incur usage charges. They return explicit configuration errors until enabled. Existing HTTPS profile-image URLs remain supported. Calls are not recorded or stored.

## Run locally

Requirements: Node.js 20+ and a MongoDB database.

1. Copy `.env.example` to `.env`; fill in `MONGODB_URI` and a random `JWT_SECRET` of at least 32 characters.
2. Set `FRONTEND_ORIGINS=http://localhost:3000` for local use.
3. Install and run:

   ```sh
   npm install
   npm run build:client
   npm start
   ```

4. Open `http://localhost:3000`. Use two separate browser profiles or devices to test invitations and calls.

`npm run dev` starts the server with Node's watch mode. `npm run check` checks the JavaScript syntax.
The build step copies the Socket.IO browser client and its license into `public/vendor/`, so the frontend does not rely on a third-party script CDN.

The browser stores the signed session JWT in an HttpOnly cookie whose expiry matches the JWT (seven days by default). It is Secure and SameSite=None over HTTPS; local HTTP development uses SameSite=Lax. There is no refresh-token endpoint, so the user must sign in again after the configured JWT expiry. Existing bearer-token clients remain supported.

For Android WebView packaging, load ConnectX over HTTPS and do not clear WebView cookies when the app closes. If the APK loads its frontend from a different site than the API, the WebView must allow third-party cookies; hosting the frontend and API on the same site avoids that dependency. This repository contains no Android wrapper source, so native WebView settings must be checked in the APK builder/wrapper.

## Deployment

### Render (backend and optional same-origin frontend)

- Create a Render Web Service from this repository; use `npm install` as the build command and `npm start` as the start command.
- Configure `MONGODB_URI`, `JWT_SECRET`, `FRONTEND_ORIGINS`, and any optional settings from `.env.example` in Render's environment settings. Never commit `.env`.
- For file and profile-image sharing, create a Cloudinary account and set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`, plus optionally `MAX_UPLOAD_SIZE_BYTES` (up to 25 MB), on the server. Do not set these in frontend configuration. Profile images are limited to 5 MB and JPEG, PNG, or WebP.
- Uploads are sent directly from the browser to Cloudinary using server-signed requests and authenticated assets. The server verifies uploaded file size and format; each chat participant receives a short-lived private download link only after a membership check. Completed assets are renamed out of the `pending_` prefix so unclaimed pending uploads can be cleaned up from the Cloudinary Media Library. Storage and transfer may be billed by Cloudinary; review its current pricing and quotas first.
- Switching from R2 does not move existing objects or update their database keys; migrate existing attachments and profile images separately before removing the old bucket if they need to remain available.
- If hosting the frontend on GitHub Pages, set `FRONTEND_ORIGINS` to the exact Pages origin, for example `https://your-user.github.io`. For a project site, the origin is still the domain root, not the repository subpath.
- Render provides HTTPS. Use only HTTPS origins in production. The app uses bearer tokens in `sessionStorage`, never in URLs; same-origin policies and the Content Security Policy reduce exposure, but an XSS flaw could still access a browser-held bearer token.
- Database access is protected by conversation membership checks. Configure MongoDB Atlas network access and a least-privilege database user for the Render service.

### GitHub Pages (frontend)

- Publish the `public/` directory using a Pages workflow or publish source configured for that folder.
- Edit `public/config.js` and set `window.CONNECTX_API_URL` to the Render service origin, such as `https://connectx-api.onrender.com` (no trailing slash), then publish the updated frontend.
- Add the Pages origin to the backend's `FRONTEND_ORIGINS`. Socket.IO uses the same configured API origin.
- Deployments must preserve query strings so invitation links (`?invite=...`) reach the app. Invite codes can also be pasted using **Join code**.

## TURN configuration

STUN can establish many direct peer connections, but cannot guarantee calls through symmetric NATs, restrictive corporate/mobile networks, or blocked UDP paths. Configure a real TURN relay for reliable cross-network connectivity.

- The server accepts comma-separated `TURN_URLS` (for example `turn:turn.example.net:3478?transport=udp,turns:turn.example.net:5349?transport=tcp`) and a private `TURN_SECRET`.
- `TURN_SECRET` must be the shared secret configured on a coturn REST-API deployment or a compatible provider that issues time-limited HMAC-SHA1 credentials. The authenticated `/api/ice-servers` endpoint returns a short-lived username and credential; the shared secret is never sent to the browser.
- Set `TURN_CREDENTIAL_TTL_SECONDS` to a provider-compatible lifetime. Keep TURN ports/firewall rules open and use TLS/TCP relay options where UDP is restricted.
- Metered and Twilio Network Traversal are managed alternatives. Follow the selected provider's current instructions and use its supported credential/API mechanism; do not put a long-lived provider secret in `public/config.js`. This starter's HMAC endpoint is specifically for shared-secret REST TURN providers; adapt the server integration if your provider requires a separate credential API.
- TURN relays consume bandwidth and are commonly billed by relay traffic or usage tier. Check current provider pricing, quotas, and limits before production use.

## Security and current limitations

- Invitation tokens grant access only through the authenticated join endpoint and are checked for expiration, revocation, and conversation capacity on the server. Never share an invite link publicly.
- JWTs are not logged or put in URLs. Browser sessions use HttpOnly cookies; sign out clears the cookie and sets a non-secret local sign-out marker so an offline logout will not silently restore the prior session on this device.
- The authenticated REST API is protected by JWT. Conversation reads, message sends/deletes, typing, calls, and signaling all validate membership server-side.
- Calls require a secure context (HTTPS, or localhost) and user permission for microphone/camera. STUN-only connectivity is best-effort.
- Message history returns the newest page first; older pages are fetched with a `before` cursor. Accounts are registered with an email and password and can sign in with either their email or username.
- Uploads allow images, videos, PDFs, common documents, CSV/text, and ZIP files. The server validates declared MIME type and stored metadata/size; it does not perform antivirus scanning or inspect file contents, so share files only with trusted contacts.
- Test file upload/download, image/video preview, and unauthorized access using two separate signed-in browser profiles. Real MongoDB, storage-bucket, and cross-device tests require those services and credentials.
- Use a reverse proxy/host with HTTPS and websocket support. Configure production secrets and origins in the hosting provider; do not expose them in frontend code.
