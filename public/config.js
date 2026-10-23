// For GitHub Pages, set this to the deployed Render API origin (no trailing slash).
// On Render, leave empty to use the same origin for API and Socket.IO.
const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname);
window.CONNECTX_API_URL = isLocalDevelopment ? '' : 'https://whtclon.onrender.com/';
