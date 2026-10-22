const API = (window.CONNECTX_API_URL || '').replace(/\/$/, '');
const root = document.getElementById('app');
const callDialog = document.getElementById('call-dialog');
const joinDialog = document.getElementById('join-dialog');
const profileDialog = document.getElementById('profile-dialog');
const tokenKey = 'connectx.session';
const state = {
  token: sessionStorage.getItem(tokenKey),
  user: null,
  socket: null,
  conversations: [],
  activeId: null,
  hasMore: false,
  loadingOlder: false,
  loadingMessageHistory: false,
  loadingHistoryConversation: null,
  pendingLiveMessages: new Map(),
  messageLoadGeneration: 0,
  typingTimer: null,
  typingActive: false,
  peerTyping: '',
  call: null,
  online: new Set(),
  iceServers: null,
  iceServersAt: 0,
  iceServersPromise: null,
  pendingAnnouncement: null
};
let socketClientPromise;
let attachmentObserver;
let attachmentLoadQueue = new WeakMap();
let profilePreviewUrl;
let profileInitialAvatarUrl = '';
let profileAvatarRemoveRequested = false;

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const initials = (name = '?') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const iconPaths = {
  sparkle: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/>',
  arrowLeft: '<path d="m15 18-6-6 6-6"/><path d="M9 12h12"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.4"/>',
  headset: '<path d="M3 13v-1a9 9 0 0 1 18 0v1"/><path d="M5 13h2a2 2 0 0 1 2 2v3H6a3 3 0 0 1-3-3v-2Zm14 0h-2a2 2 0 0 0-2 2v3h3a3 3 0 0 0 3-3v-2Z"/><path d="M15 19a4 4 0 0 1-3 1h-1"/>',
  callEnd: '<path d="M7 3h3l2 5-2 2a15 15 0 0 0 4 4l2-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 5 5a2 2 0 0 1 2-2Z"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',
  expand: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  micOff: '<path d="m2 2 20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 9V5a3 3 0 0 0-5.8-1M5 10v2a7 7 0 0 0 12 5m2-5v-2M12 19v3m-4 0h8"/>',
  camera: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10 5-3v10l-5-3"/>',
  cameraOff: '<path d="m2 2 20 20M10 6h4a2 2 0 0 1 2 2v.5l5-3v13l-5-3V16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2"/>',
  switch: '<path d="m17 3 4 4-4 4M3 7h18M7 21l-4-4 4-4m14 4H3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1 0 2Z"/>',
  logout: '<path d="M10 17l5-5-5-5m5 5H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
  system: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  close: '<path d="m18 6-12 12M6 6l12 12"/>'
};
const icon = (name, className = '') => `<svg class="icon-svg ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name]}</svg>`;
const inviteTokenPattern = /^[A-Za-z0-9_-]{40,100}$/;
const formatTime = (date) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(date));
const formatDate = (date) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date));
const activeConversation = () => state.conversations.find((conversation) => conversation._id === state.activeId);
const otherPerson = (conversation) => conversation?.other ||
  conversation?.participantIds?.find((person) => person._id !== state.user?._id) || null;
const inviteFromUrl = () => new URLSearchParams(location.search).get('invite');

function parseInvitationInput(value) {
  const input = value.trim();
  if (!input) return { error: 'Paste an invitation link or code to continue.' };
  if (inviteTokenPattern.test(input)) return { token: input };

  let url;
  try {
    url = new URL(input, location.href);
  } catch {
    return { error: 'That doesn’t look like a valid invitation link or code.' };
  }
  const currentPath = location.pathname.replace(/\/+$/, '');
  const inputPath = url.pathname.replace(/\/+$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin || inputPath !== currentPath) {
    return { error: 'Use a ConnectX invitation link for this site.' };
  }
  const token = url.searchParams.get('invite');
  if (!token || !inviteTokenPattern.test(token)) {
    return { error: 'This link is missing a valid invitation code.' };
  }
  return { token };
}

function updateJoinFeedback(message = '', error = false, keepValid = false) {
  const feedback = document.getElementById('join-feedback');
  const input = document.getElementById('join-input');
  const indicator = document.getElementById('join-valid-indicator');
  const submit = document.getElementById('join-submit');
  if (!feedback || !input || !indicator || !submit) return;
  const parsed = parseInvitationInput(input.value);
  if (!message && input.value.trim() && parsed.error) {
    message = parsed.error;
    error = true;
  }
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
  input.setAttribute('aria-invalid', String(error && !keepValid));
  const valid = Boolean(parsed.token);
  indicator.classList.toggle('visible', valid);
  submit.disabled = Boolean(joinDialog.dataset.joining);
}

function openJoinDialog() {
  const input = document.getElementById('join-input');
  const submit = document.getElementById('join-submit');
  input.value = '';
  submit.disabled = true;
  updateJoinFeedback();
  joinDialog.showModal();
  input.focus();
}

function closeJoinDialog() {
  if (joinDialog.open && !joinDialog.dataset.joining) joinDialog.close();
}

function applyThemeMode(mode) {
  window.connectXTheme?.setMode(mode);
  updateThemeButton();
}

function updateThemeButton() {
  const button = document.getElementById('theme-toggle');
  if (!button) return;
  const mode = window.connectXTheme?.getMode() || 'system';
  const labels = { system: 'System default', light: 'Light mode', dark: 'Dark mode' };
  const nextMode = { system: 'light', light: 'dark', dark: 'system' }[mode];
  const icons = { system: 'system', light: 'sun', dark: 'moon' };
  button.innerHTML = icon(icons[mode]);
  button.title = `Theme: ${labels[mode]}. Switch to ${labels[nextMode]}.`;
  button.setAttribute('aria-label', button.title);
}

function cycleTheme() {
  const mode = window.connectXTheme?.getMode() || 'system';
  applyThemeMode({ system: 'light', light: 'dark', dark: 'system' }[mode]);
}

function bindDialogControls() {
  const joinInput = document.getElementById('join-input');
  joinInput.addEventListener('input', () => updateJoinFeedback());
  document.getElementById('join-paste').addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard access is unavailable.');
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText.trim()) {
        updateJoinFeedback('Your clipboard is empty. Paste a link with Ctrl+V or Command+V.', true, true);
        joinInput.focus();
        return;
      }
      joinInput.value = clipboardText.trim();
      updateJoinFeedback();
      joinInput.focus();
    } catch {
      updateJoinFeedback('Clipboard access was blocked. Click the field and paste with Ctrl+V or Command+V.', true, true);
      joinInput.focus();
    }
  });
  document.getElementById('join-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (joinDialog.dataset.joining) return;
    const parsed = parseInvitationInput(joinInput.value);
    if (!parsed.token) {
      updateJoinFeedback(parsed.error, true);
      return;
    }
    const submit = document.getElementById('join-submit');
    const cancel = document.getElementById('join-cancel');
    const paste = document.getElementById('join-paste');
    joinDialog.dataset.joining = 'true';
    submit.disabled = true;
    cancel.disabled = true;
    paste.disabled = true;
    document.getElementById('join-close').disabled = true;
    submit.textContent = 'Joining…';
    updateJoinFeedback('Connecting to your conversation…');
    const result = await joinInvitation(parsed.token, false);
    delete joinDialog.dataset.joining;
    cancel.disabled = false;
    paste.disabled = false;
    document.getElementById('join-close').disabled = false;
    submit.textContent = 'Join conversation';
    submit.disabled = false;
    if (result.ok) {
      joinDialog.close();
      return;
    }
    updateJoinFeedback(result.error, true, true);
  });
  document.getElementById('join-close').addEventListener('click', closeJoinDialog);
  document.getElementById('join-cancel').addEventListener('click', closeJoinDialog);
  joinDialog.addEventListener('cancel', (event) => {
    if (joinDialog.dataset.joining) event.preventDefault();
  });
  joinDialog.addEventListener('click', (event) => {
    if (event.target === joinDialog) closeJoinDialog();
  });
  joinDialog.addEventListener('close', () => {
    if (!joinDialog.dataset.joining) {
      joinInput.value = '';
      updateJoinFeedback();
    }
  });
  document.getElementById('profile-close').addEventListener('click', () => profileDialog.close());
  document.getElementById('profile-cancel').addEventListener('click', () => profileDialog.close());
  document.getElementById('profile-avatar-file').addEventListener('change', (event) => {
    const file = event.currentTarget.files?.[0];
    const feedback = document.getElementById('profile-feedback');
    feedback.textContent = '';
    feedback.classList.remove('error');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      event.currentTarget.value = '';
      feedback.textContent = 'Choose a JPEG, PNG, or WebP image up to 5 MB.';
      feedback.classList.add('error');
      return;
    }
    if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    profilePreviewUrl = URL.createObjectURL(file);
    document.getElementById('profile-avatar-remove').disabled = false;
    const image = document.createElement('img');
    image.className = 'avatar profile-preview-avatar';
    image.src = profilePreviewUrl;
    image.alt = 'Selected profile picture preview';
    document.getElementById('profile-avatar-preview').replaceChildren(image);
  });
  document.getElementById('profile-avatar-remove').addEventListener('click', () => {
    document.getElementById('profile-avatar-file').value = '';
    document.getElementById('profile-avatar-url').value = '';
    profileAvatarRemoveRequested = true;
    document.getElementById('profile-avatar-remove').disabled = true;
    if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    profilePreviewUrl = null;
    document.getElementById('profile-avatar-preview').innerHTML =
      avatarMarkup({ ...state.user, avatarUrl: '', hasAvatar: false }, 'profile-preview-avatar');
  });
  document.getElementById('profile-avatar-url').addEventListener('input', (event) => {
    document.getElementById('profile-avatar-remove').disabled =
      !event.currentTarget.value.trim() && !state.user.avatarUrl && !state.user.hasAvatar;
  });
  document.getElementById('profile-form').addEventListener('submit', editProfile);
  profileDialog.addEventListener('close', () => {
    if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
    profilePreviewUrl = null;
  });
  profileDialog.addEventListener('click', (event) => {
    if (event.target === profileDialog) profileDialog.close();
  });
}

function notify(message, error = false) {
  const region = document.getElementById('toast-region');
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' error' : ''}`;
  toast.textContent = message;
  region.append(toast);
  setTimeout(() => toast.remove(), 3800);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
  const response = await fetch(`${API}/api${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function renderAuth(register = false) {
  document.title = register ? 'Create account | ConnectX' : 'Sign in | ConnectX';
  const inviteToken = inviteFromUrl();
  root.innerHTML = `
    <section class="auth-wrap">
      <form class="auth-card" id="auth-form">
        <a class="brand-link" href="./" aria-label="ConnectX home"><span class="brand-row"><span class="brand-mark">C</span><h1>ConnectX</h1></span></a>
        <h2>${register ? 'Create your account' : 'Welcome back'}</h2>
        <p>${register ? 'A more personal way to stay close, wherever life takes you.' : 'Sign in to pick up right where you left off.'}</p>
        ${inviteToken ? '<div class="invite-card">You have a private chat invitation. Sign in or create an account to join.</div>' : ''}
        ${register ? `<div class="field"><label for="display-name">Display name</label><input id="display-name" name="displayName" maxlength="60" required autocomplete="name"></div>
          <div class="field"><label for="username">Username</label><input id="username" name="username" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" required autocomplete="username"></div>` : ''}
        <div class="field"><label for="${register ? 'email' : 'identifier'}">${register ? 'Email' : 'Email or username'}</label><input id="${register ? 'email' : 'identifier'}" name="${register ? 'email' : 'identifier'}" type="${register ? 'email' : 'text'}" maxlength="254" required autocomplete="${register ? 'email' : 'username'}" ${register ? '' : 'autocapitalize="none" spellcheck="false"'}></div>
        <div class="field"><label for="password">Password${register ? ' (10+ characters)' : ''}</label><input id="password" name="password" type="password" minlength="${register ? 10 : 1}" maxlength="128" required autocomplete="${register ? 'new-password' : 'current-password'}"></div>
        <button class="button primary" type="submit">${register ? 'Create account' : 'Sign in'}</button>
        <p class="auth-switch">${register ? 'Already have an account?' : 'New to ConnectX?'}
          <button class="link-button" type="button" id="toggle-auth">${register ? 'Sign in' : 'Create account'}</button>
        </p>
      </form>
    </section>`;
  document.getElementById('toggle-auth').addEventListener('click', () => renderAuth(!register));

  document.getElementById('auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const submitButton = formElement.querySelector('[type="submit"]');
    if (submitButton.disabled) return;
    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = register ? 'Creating account…' : 'Signing in…';
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());
    try {
      const result = await request(`/auth/${register ? 'register' : 'login'}`, {
        method: 'POST', body: JSON.stringify(body)
      });
      state.token = result.token;
      state.user = result.user;
      sessionStorage.setItem(tokenKey, result.token);
      notify(register ? 'Your account is ready.' : 'Signed in successfully.');
      startApp();
    } catch (error) {
      notify(error.message, true);
    } finally {
      if (formElement.isConnected) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
    }
  });
}

function avatarMarkup(person, sizeClass = '') {
  if (person?.hasAvatar && person?._id) {
    const avatarUrl = `${API}/api/avatars/${encodeURIComponent(person._id)}?v=${encodeURIComponent(person.avatarVersion || 0)}`;
    return `<img class="avatar ${sizeClass}" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  }
  if (person?.avatarUrl && /^https:\/\//i.test(person.avatarUrl)) {
    return `<img class="avatar ${sizeClass}" src="${escapeHtml(person.avatarUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  }
  return `<span class="avatar ${sizeClass}" aria-hidden="true">${escapeHtml(initials(person?.displayName || 'ConnectX'))}</span>`;
}

function renderShell(announce = false) {
  attachmentObserver?.disconnect();
  attachmentObserver = null;
  attachmentLoadQueue = new WeakMap();
  const conversation = activeConversation();
  const person = otherPerson(conversation);
  document.title = person ? `${person.displayName} | ConnectX` : 'ConnectX — Stay close';
  const filter = document.getElementById('conversation-search')?.value.toLowerCase() || '';
  const visible = state.conversations.filter((conversation) => {
    const person = otherPerson(conversation);
    return `${person?.displayName || 'New conversation'} ${person?.username || ''}`.toLowerCase().includes(filter);
  });
  root.innerHTML = `
    <div class="shell ${state.activeId ? 'in-chat' : ''}">
      <aside class="sidebar">
        <div class="side-top">
          <a class="brand-link" href="./" aria-label="ConnectX home" data-home><span class="brand-row"><span class="brand-mark">C</span><h1>ConnectX</h1></span></a>
          <p class="brand-subtitle">Private conversations, wherever you are.</p>
          <label class="search-wrap"><span class="search-icon">${icon('search')}</span><input id="conversation-search" type="search" placeholder="Search conversations" aria-label="Search conversations" value="${escapeHtml(filter)}"></label>
        </div>
        <div class="side-actions">
          <button class="button primary" id="new-chat" type="button">${icon('plus')} New chat</button>
          <button class="button secondary" id="join-chat" type="button">${icon('link')} Join</button>
        </div>
        <div class="chat-list-heading"><h2 class="section-label">CHATS</h2><button class="icon-button theme-toggle" id="theme-toggle" type="button"></button></div>
        <div class="chat-list" id="chat-list">${chatItemsMarkup(visible)}</div>
        <div class="profile-row">
          ${avatarMarkup(state.user)}
          <span class="profile-copy"><strong>${escapeHtml(state.user.displayName)}</strong><small>@${escapeHtml(state.user.username)}</small>${state.user.about ? `<small class="profile-about-preview">${escapeHtml(state.user.about)}</small>` : ''}</span>
          <button class="icon-button" id="edit-profile" type="button" aria-label="Edit profile" title="Edit profile">${icon('settings')}</button>
          <button class="icon-button" id="sign-out" type="button" aria-label="Sign out" title="Sign out">${icon('logout')}</button>
        </div>
      </aside>
      <section class="chat-panel" id="chat-panel"></section>
    </div>`;
  document.getElementById('conversation-search').addEventListener('input', () => renderChatList());
  document.getElementById('new-chat').addEventListener('click', createConversation);
  document.getElementById('join-chat').addEventListener('click', joinByCode);
  document.getElementById('theme-toggle').addEventListener('click', cycleTheme);
  updateThemeButton();
  document.getElementById('edit-profile').addEventListener('click', openProfileDialog);
  document.getElementById('sign-out').addEventListener('click', signOut);
  document.querySelector('[data-home]')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (state.call) return notify('End the call before leaving the conversation.', true);
    stopTyping();
    state.activeId = null;
    state.pendingAnnouncement = null;
    renderShell();
  });
  bindChatItems();
  return renderChatPanel(announce);
}

function chatItemsMarkup(conversations) {
  return conversations.length ? conversations.map((conversation) => {
    const person = otherPerson(conversation);
    return `<button class="chat-item ${state.activeId === conversation._id ? 'active' : ''}" data-open-chat="${escapeHtml(conversation._id)}" type="button">
      ${avatarMarkup(person)}
      <span class="chat-summary">
        <span class="chat-summary-top"><span class="chat-name">${escapeHtml(person?.displayName || 'Waiting for someone')}</span><span class="chat-time">${conversation.lastMessage ? escapeHtml(formatTime(conversation.lastMessage.createdAt)) : ''}</span></span>
        <span class="chat-summary-bottom"><span class="chat-preview">${escapeHtml(conversation.lastMessage?.text || 'No messages yet')}</span>${conversation.unreadCount ? `<span class="unread">${conversation.unreadCount}</span>` : ''}</span>
      </span>
    </button>`;
  }).join('') : '<div class="chat-empty"><p>No conversations yet. Start a private chat and share its invite link.</p></div>';
}

function bindChatItems() {
  document.querySelectorAll('[data-open-chat]').forEach((button) =>
    button.addEventListener('click', () => openConversation(button.dataset.openChat)));
}

function renderChatList() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  const filter = document.getElementById('conversation-search')?.value.toLowerCase() || '';
  const visible = state.conversations.filter((conversation) => {
    const person = otherPerson(conversation);
    return `${person?.displayName || 'New conversation'} ${person?.username || ''}`.toLowerCase().includes(filter);
  });
  list.innerHTML = chatItemsMarkup(visible);
  bindChatItems();
}

function renderChatPanel(announce = false) {
  const panel = document.getElementById('chat-panel');
  if (!panel) return;
  const conversation = activeConversation();
  if (!conversation) {
    panel.innerHTML = `<div class="chat-empty"><div class="empty-illustration">${icon('sparkle')}</div><h2>Your people, one message away.</h2><p>Create a private chat and share an invite link. No contact syncing needed.</p></div>`;
    return;
  }
  const person = otherPerson(conversation);
  panel.innerHTML = `
    <header class="chat-header">
      <button class="icon-button back-button" id="back-to-list" type="button" aria-label="Back to chats">${icon('arrowLeft')}</button>
      <span data-peer-avatar>${avatarMarkup(person)}</span>
      <div class="chat-header-info"><strong>${escapeHtml(person?.displayName || 'Waiting for someone')}</strong><span>${person ? (state.online.has(person._id) ? 'Online' : `Last seen ${formatTime(person.lastSeenAt || Date.now())}`) : 'Share an invitation to get started'}</span>${person?.about ? `<small class="chat-about">${escapeHtml(person.about)}</small>` : ''}</div>
      <div class="header-actions">
        <button class="icon-button" id="share-invite" type="button" aria-label="Share invitation" title="Share invitation" ${conversation.createdBy === state.user._id && !person ? '' : 'disabled'}>${icon('share')}</button>
        <button class="icon-button call-action audio-action" id="audio-call" type="button" aria-label="Start audio call" title="Audio call" ${person ? '' : 'disabled'}>${icon('headset')}</button>
        <button class="icon-button call-action video-action" id="video-call" type="button" aria-label="Start video call" title="Video call" ${person ? '' : 'disabled'}>${icon('video')}</button>
        <button class="icon-button" id="leave-chat" type="button" aria-label="Leave conversation" title="Leave conversation">${icon('more')}</button>
        ${conversation.createdBy === state.user._id ? `<button class="icon-button" id="revoke-invite" type="button" aria-label="Revoke invitation" title="Revoke invitation">${icon('ban')}</button>` : ''}
      </div>
    </header>
    <div class="messages" id="messages" role="log" aria-label="Messages"></div>
    <div class="typing-indicator" id="typing-indicator">${escapeHtml(state.peerTyping)}</div>
    <div class="upload-status" id="upload-status" aria-live="polite" hidden></div>
    <form class="composer" id="composer">
      <input id="attachment-picker" class="visually-hidden" type="file" multiple
        accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip">
      <button class="icon-button attach-button" id="attach-file" type="button" aria-label="Attach file" title="Share files">${icon('plus')}</button>
      <textarea id="message-input" rows="1" maxlength="4000" placeholder="Write a message…" aria-label="Message"></textarea>
      <button class="send-button" type="submit" aria-label="Send message">${icon('send')}</button>
    </form>
    <div class="call-screen" id="call-screen" hidden></div>`;
  document.getElementById('back-to-list').addEventListener('click', () => {
    stopTyping();
    state.activeId = null;
    renderShell();
  });
  document.getElementById('share-invite').addEventListener('click', shareInvite);
  document.getElementById('audio-call').addEventListener('click', () => startCall('audio'));
  document.getElementById('video-call').addEventListener('click', () => startCall('video'));
  document.getElementById('leave-chat').addEventListener('click', leaveConversation);
  document.getElementById('revoke-invite')?.addEventListener('click', revokeInvitation);
  const picker = document.getElementById('attachment-picker');
  document.getElementById('attach-file').addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    if (picker.files?.length) void uploadFiles([...picker.files], conversation._id);
    picker.value = '';
  });
  panel.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    panel.classList.add('drag-over');
  });
  panel.addEventListener('dragleave', (event) => {
    if (!panel.contains(event.relatedTarget)) panel.classList.remove('drag-over');
  });
  panel.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    panel.classList.remove('drag-over');
    void uploadFiles([...event.dataTransfer.files], conversation._id);
  });
  document.getElementById('composer').addEventListener('submit', sendMessage);
  const input = document.getElementById('message-input');
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      document.getElementById('composer').requestSubmit();
    }
  });
  input.addEventListener('input', onTyping);
  const messageBox = document.getElementById('messages');
  messageBox.addEventListener('scroll', () => {
    if (messageBox.scrollTop < 30 && state.hasMore && !state.loadingOlder) loadOlderMessages();
  });
  return loadMessages(conversation._id, announce);
}

const maxClientUploadSize = 25 * 1024 * 1024;
const allowedClientAttachmentTypes = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm',
  'application/pdf', 'text/plain', 'text/csv', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip'
]);

function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function makeUploadStatus(file) {
  const region = document.getElementById('upload-status');
  if (!region) return null;
  region.hidden = false;
  const item = document.createElement('div');
  item.className = 'upload-progress';
  const label = document.createElement('span');
  label.textContent = `Uploading ${file.name}`;
  const progress = document.createElement('progress');
  progress.max = 100;
  progress.value = 0;
  item.append(label, progress);
  region.append(item);
  return { item, label, progress };
}

function uploadForm(fields, file) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('The upload service response is missing Cloudinary signing fields. Redeploy the backend with the latest Cloudinary upload support.');
  }
  const requiredFields = ['api_key', 'context', 'overwrite', 'public_id', 'signature', 'timestamp', 'type'];
  if (requiredFields.some((name) => !(name in fields))) {
    throw new Error('The upload service returned incomplete Cloudinary signing fields. Check the backend deployment and Cloudinary configuration.');
  }
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, String(value));
  form.append('file', file);
  return form;
}

function putFile(uploadUrl, fields, file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    if (typeof uploadUrl !== 'string' || !/^https:\/\/api\.cloudinary\.com\/v1_1\/[^/]+\/(image|video|raw)\/upload$/.test(uploadUrl)) {
      reject(new Error('The upload service returned an invalid Cloudinary upload URL. Redeploy the backend and check its Cloudinary configuration.'));
      return;
    }
    let body;
    try {
      body = uploadForm(fields, file);
    } catch (error) {
      reject(error);
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.timeout = 120000;
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let message = '';
        try {
          message = JSON.parse(xhr.responseText).error?.message || '';
        } catch { /* Cloudinary may return a non-JSON error response. */ }
        reject(new Error(message
          ? `Cloudinary upload failed: ${message}`
          : `Upload failed (HTTP ${xhr.status || 'network error'}). Check Cloudinary configuration and try again.`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed. Check your connection and Cloudinary configuration.')));
    xhr.addEventListener('abort', () => reject(new Error('Upload was cancelled.')));
    xhr.addEventListener('timeout', () => reject(new Error('Cloudinary upload timed out. Check your connection and try again.')));
    xhr.send(body);
  });
}

async function uploadFiles(files, conversationId) {
  if (files.length > 5) {
    notify('Select no more than 5 files at a time.', true);
    return;
  }
  for (const file of files) {
    const progress = makeUploadStatus(file);
    try {
      if (!allowedClientAttachmentTypes.has(file.type) || file.size < 1 || file.size > maxClientUploadSize) {
        throw new Error(`${file.name} is not a supported file or exceeds the 25 MB limit.`);
      }
      if (progress) progress.label.textContent = `Preparing ${file.name}`;
      const upload = await request(`/conversations/${encodeURIComponent(conversationId)}/uploads`, {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size })
      });
      if (progress) progress.label.textContent = `Uploading ${file.name}`;
      await putFile(upload.uploadUrl, upload.fields, file, (value) => {
        if (progress) progress.progress.value = value;
      });
      if (progress) progress.label.textContent = `Sending ${file.name}`;
      const result = await request(`/conversations/${encodeURIComponent(conversationId)}/uploads/${encodeURIComponent(upload.attachmentId)}/send`, {
        method: 'POST',
        body: JSON.stringify({
          fileName: upload.fileName,
          contentType: upload.contentType,
          size: upload.size,
          clientMessageId: crypto.randomUUID()
        })
      });
      if (!result?.ok) throw new Error(result?.error || 'The file was uploaded but could not be sent.');
      const conversation = state.conversations.find((item) => item._id === conversationId);
      if (conversation) {
        conversation.lastMessage = { text: 'Attachment', createdAt: result.message.createdAt };
        conversation.lastMessageAt = result.message.createdAt;
      }
      renderMessage(result.message);
      const messages = document.getElementById('messages');
      if (messages) messages.scrollTop = messages.scrollHeight;
      renderChatList();
      if (progress) {
        progress.label.textContent = `Sent ${file.name}`;
        progress.progress.value = 100;
        setTimeout(() => {
          progress.item.remove();
          const region = document.getElementById('upload-status');
          if (region && !region.children.length) region.hidden = true;
        }, 3500);
      }
    } catch (error) {
      if (progress) {
        progress.label.textContent = `Could not send ${file.name}: ${error.message}`;
        progress.item.classList.add('error');
      }
      notify(error.message, true);
    }
  }
}

function renderAttachment(message, attachment, bubble) {
  const card = document.createElement('div');
  card.className = 'message-attachment';
  const name = document.createElement('span');
  name.className = 'attachment-name';
  name.textContent = attachment.fileName;
  const details = document.createElement('span');
  details.className = 'attachment-details';
  details.textContent = `${attachment.contentType} · ${formatFileSize(attachment.size)}`;
  const preview = document.createElement('div');
  preview.className = 'attachment-preview';
  const link = document.createElement('a');
  link.textContent = 'Loading secure link…';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `Download ${attachment.fileName}`);
  card.append(name, details, preview, link);
  bubble.append(card);
  const load = () => request(`/conversations/${encodeURIComponent(message.conversationId)}/messages/${encodeURIComponent(message._id)}/attachments/${encodeURIComponent(attachment.attachmentId)}`)
    .then(({ url, downloadUrl }) => {
      link.href = downloadUrl;
      link.textContent = 'Download';
      if (attachment.contentType.startsWith('image/')) {
        const image = document.createElement('img');
        image.src = url;
        image.alt = attachment.fileName;
        image.loading = 'lazy';
        image.decoding = 'async';
        preview.append(image);
      } else if (attachment.contentType.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.preload = 'metadata';
        video.setAttribute('aria-label', attachment.fileName);
        preview.append(video);
      }
    })
    .catch(() => {
      link.textContent = 'Attachment unavailable';
      link.removeAttribute('href');
    });
  if (!('IntersectionObserver' in window)) {
    void load();
  } else {
    if (!attachmentObserver) {
      attachmentObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          const loadAttachment = attachmentLoadQueue.get(entry.target);
          attachmentLoadQueue.delete(entry.target);
          if (loadAttachment) void loadAttachment();
        });
      }, { rootMargin: '120px' });
    }
    attachmentLoadQueue.set(card, load);
    attachmentObserver.observe(card);
  }
}

function renderMessage(message, prepend = false) {
  const box = document.getElementById('messages');
  if (!box || box.querySelector(`[data-message-id="${CSS.escape(message._id)}"]`)) return;
  const mine = message.sender?._id === state.user._id || message.senderId === state.user._id;
  const row = document.createElement('div');
  row.className = `message-row${mine ? ' mine' : ''}`;
  row.dataset.messageId = message._id;
  row.dataset.createdAt = message.createdAt;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (message.deleted) {
    bubble.textContent = 'Message deleted';
  } else {
    if (message.text) {
      const text = document.createElement('div');
      text.textContent = message.text;
      bubble.append(text);
    }
    (message.attachments || []).forEach((attachment) => renderAttachment(message, attachment, bubble));
  }
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const time = document.createElement('span');
  time.textContent = formatTime(message.createdAt);
  meta.append(time);
  if (mine) {
    const status = document.createElement('span');
    status.textContent = (message.readBy || []).length > 1 ? 'Read' : 'Sent';
    status.className = 'message-status';
    meta.append(status);
  }
  if (!message.deleted && message.text) {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy-message';
    copyButton.textContent = 'Copy';
    copyButton.setAttribute('aria-label', 'Copy message');
    copyButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(message.text || '');
        notify('Message copied.');
      } catch { notify('Could not access the clipboard.', true); }
    });
    meta.append(copyButton);
  }
  bubble.append(meta);
  bubble.title = mine ? 'Right-click to delete your message' : '';
  if (mine && !message.deleted) {
    bubble.addEventListener('contextmenu', async (event) => {
      event.preventDefault();
      if (!confirm('Delete this message for everyone?')) return;
      try {
        const result = await request(`/conversations/${state.activeId}/messages/${message._id}`, { method: 'DELETE' });
        message.text = '';
        message.attachments = [];
        message.deleted = true;
        markMessageDeleted(message._id);
        socketEmit('message:delete', { conversationId: state.activeId, messageId: message._id });
        if (result.cleanupWarning) notify('Message deleted, but stored files could not be removed. Please contact support.', true);
      } catch (error) { notify(error.message, true); }
    });
  }
  row.append(bubble);
  if (prepend) box.prepend(row); else box.append(row);
}

function markMessageDeleted(messageId) {
  const bubble = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"] .bubble`);
  if (!bubble) return;
  const meta = bubble.querySelector('.message-meta');
  meta?.querySelector('.copy-message')?.remove();
  bubble.replaceChildren(document.createTextNode('Message deleted'));
  if (meta) bubble.append(meta);
}

async function loadMessages(conversationId, announce = false) {
  const box = document.getElementById('messages');
  if (!box) return;
  const generation = ++state.messageLoadGeneration;
  state.loadingMessageHistory = true;
  state.loadingHistoryConversation = conversationId;
  state.pendingLiveMessages.clear();
  box.innerHTML = '<div class="day-divider">Loading messages…</div>';
  try {
    const joinPromise = state.socket?.connected
      ? joinSocketConversation(conversationId, announce).then(() => {
        if (state.pendingAnnouncement === conversationId) state.pendingAnnouncement = null;
      })
      : Promise.resolve();
    joinPromise.catch((error) => {
      if (state.activeId === conversationId) notify(error.message, true);
    });
    const result = await request(`/conversations/${conversationId}/messages?limit=30`);
    if (state.messageLoadGeneration !== generation) return;
    if (state.activeId !== conversationId || !box.isConnected) return;
    const liveMessages = [...state.pendingLiveMessages.values()]
      .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
    box.replaceChildren();
    state.hasMore = result.hasMore;
    result.messages.forEach((message) => renderMessage(message));
    liveMessages.forEach((message) => renderMessage(message));
    if (!result.messages.length) box.innerHTML = '<div class="day-divider">This is the beginning of your conversation</div>';
    box.scrollTop = box.scrollHeight;
    socketEmit('message:read', { conversationId });
    const conversation = activeConversation();
    if (conversation) conversation.unreadCount = 0;
    renderShellListOnly();
  } catch (error) {
    if (state.messageLoadGeneration === generation &&
        state.activeId === conversationId && box.isConnected) {
      box.textContent = error.message;
      for (const message of state.pendingLiveMessages.values()) {
        renderMessage(message);
      }
      notify(error.message, true);
    }
  } finally {
    if (state.messageLoadGeneration === generation) {
      state.loadingMessageHistory = false;
      state.loadingHistoryConversation = null;
      state.pendingLiveMessages.clear();
    }
  }
}

async function loadOlderMessages() {
  const box = document.getElementById('messages');
  const first = box?.querySelector('[data-message-id]');
  if (!first) return;
  const firstTop = first.getBoundingClientRect().top;
  state.loadingOlder = true;
  try {
    const result = await request(`/conversations/${state.activeId}/messages?limit=30&beforeAt=${encodeURIComponent(first.dataset.createdAt || '')}&beforeId=${encodeURIComponent(first.dataset.messageId || '')}`);
    state.hasMore = result.hasMore;
    result.messages.forEach((message) => {
      const row = document.querySelector(`[data-message-id="${CSS.escape(message._id)}"]`);
      if (!row) {
        renderMessage(message, true);
        const inserted = document.querySelector(`[data-message-id="${CSS.escape(message._id)}"]`);
        if (inserted) inserted.dataset.createdAt = message.createdAt;
      }
    });
    const updatedFirst = box.querySelector('[data-message-id]');
    if (updatedFirst) box.scrollTop += updatedFirst.getBoundingClientRect().top - firstTop;
  } catch (error) { notify(error.message, true); }
  finally { state.loadingOlder = false; }
}

function renderShellListOnly() {
  renderChatList();
}

function updateActiveChatHeader() {
  const conversation = activeConversation();
  const person = otherPerson(conversation);
  if (!conversation) return;
  const avatar = document.querySelector('[data-peer-avatar]');
  if (avatar) avatar.innerHTML = avatarMarkup(person);
  const info = document.querySelector('.chat-header-info');
  if (info) {
    info.querySelector('strong').textContent = person?.displayName || 'Waiting for someone';
    info.querySelector('span').textContent = person
      ? (state.online.has(person._id) ? 'Online' : `Last seen ${formatTime(person.lastSeenAt || Date.now())}`)
      : 'Share an invitation to get started';
    let about = info.querySelector('.chat-about');
    if (person?.about) {
      if (!about) {
        about = document.createElement('small');
        about.className = 'chat-about';
        info.append(about);
      }
      about.textContent = person.about;
    } else {
      about?.remove();
    }
  }
  document.title = person ? `${person.displayName} | ConnectX` : 'ConnectX — Stay close';
  const shareButton = document.getElementById('share-invite');
  if (shareButton) shareButton.disabled = conversation.createdBy !== state.user._id || Boolean(person);
  for (const id of ['audio-call', 'video-call']) {
    const button = document.getElementById(id);
    if (button) button.disabled = !person;
  }
}

async function refreshConversations({ render = true } = {}) {
  const data = await request('/conversations');
  state.conversations = data.conversations;
  if (render) await renderShell();
}

async function openConversation(id, announce = false) {
  if (state.activeId !== id) stopTyping();
  state.activeId = id;
  state.peerTyping = '';
  state.pendingAnnouncement = announce ? id : null;
  await renderShell(announce);
}

async function createConversation() {
  try {
    const result = await request('/conversations', { method: 'POST', body: '{}' });
    await refreshConversations({ render: false });
    state.activeId = result.conversationId;
    await renderShell();
    await showInvite(result.inviteToken, result.expiresAt);
  } catch (error) { notify(error.message, true); }
}

async function showInvite(token, expiresAt) {
  const link = `${location.origin}${location.pathname}?invite=${encodeURIComponent(token)}`;
  try {
    await navigator.clipboard.writeText(link);
    notify(`Invite link copied. It expires ${formatDate(expiresAt)}.`);
  } catch {
    prompt('Copy and share this private invitation link:', link);
  }
}

async function shareInvite() {
  try {
    const result = await request(`/conversations/${state.activeId}/invitations`, { method: 'POST', body: '{}' });
    const link = `${location.origin}${location.pathname}?invite=${encodeURIComponent(result.inviteToken)}`;
    await navigator.clipboard.writeText(link);
    notify('New private invitation link copied.');
  } catch (error) { notify(error.message, true); }
}

async function revokeInvitation() {
  if (!confirm('Revoke all active invitation links for this conversation?')) return;
  try {
    await request(`/conversations/${state.activeId}/invitations/revoke`, { method: 'POST', body: '{}' });
    notify('Active invitation links revoked.');
  } catch (error) { notify(error.message, true); }
}

async function joinByCode() {
  openJoinDialog();
}

async function joinInvitation(token, notifyFailure = true) {
  try {
    const result = await request('/conversations/join', {
      method: 'POST', body: JSON.stringify({ token })
    });
    history.replaceState(null, '', location.pathname);
    await refreshConversations({ render: false });
    await openConversation(result.conversationId, true);
    notify('You joined the conversation.');
    return { ok: true };
  } catch (error) {
    if (notifyFailure) notify(error.message, true);
    return { ok: false, error: error.message };
  }
}

async function leaveConversation() {
  if (!confirm('Leave this private conversation? You will lose access to its messages.')) return;
  try {
    const leftId = state.activeId;
    stopTyping(leftId);
    await request(`/conversations/${leftId}/leave`, { method: 'POST', body: '{}' });
    state.activeId = null;
    await refreshConversations();
    notify('You left the conversation.');
  } catch (error) { notify(error.message, true); }
}

function openProfileDialog() {
  document.getElementById('profile-display-name').value = state.user.displayName || '';
  document.getElementById('profile-about').value = state.user.about || '';
  document.getElementById('profile-avatar-url').value = state.user.avatarUrl || '';
  profileInitialAvatarUrl = state.user.avatarUrl || '';
  profileAvatarRemoveRequested = false;
  document.getElementById('profile-avatar-remove').disabled =
    !state.user.avatarUrl && !state.user.hasAvatar;
  document.getElementById('profile-avatar-file').value = '';
  document.getElementById('profile-avatar-preview').innerHTML = avatarMarkup(state.user, 'profile-preview-avatar');
  if (profilePreviewUrl) URL.revokeObjectURL(profilePreviewUrl);
  profilePreviewUrl = null;
  const feedback = document.getElementById('profile-feedback');
  feedback.textContent = '';
  feedback.classList.remove('error');
  profileDialog.showModal();
  document.getElementById('profile-display-name').focus();
}

async function editProfile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = document.getElementById('profile-save');
  const feedback = document.getElementById('profile-feedback');
  const originalLabel = submit.textContent;
  const displayName = document.getElementById('profile-display-name').value.trim();
  const about = document.getElementById('profile-about').value.trim();
  const avatarUrl = document.getElementById('profile-avatar-url').value.trim();
  const avatarFile = document.getElementById('profile-avatar-file').files?.[0];
  if (!displayName || displayName.length > 60) {
    feedback.textContent = 'Display name must be between 1 and 60 characters.';
    feedback.classList.add('error');
    document.getElementById('profile-display-name').focus();
    return;
  }
  if (about.length > 240) {
    feedback.textContent = 'About must be 240 characters or fewer.';
    feedback.classList.add('error');
    document.getElementById('profile-about').focus();
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Saving…';
  feedback.textContent = '';
  feedback.classList.remove('error');
  try {
    let data;
    if (avatarFile) {
      const upload = await request('/profile/avatar-upload', {
        method: 'POST', body: JSON.stringify({ contentType: avatarFile.type, size: avatarFile.size })
      });
      if (typeof upload.uploadUrl !== 'string' || !upload.fields || typeof upload.fields !== 'object') {
        throw new Error('The upload service response is missing Cloudinary signing fields. Redeploy the backend with the latest Cloudinary upload support.');
      }
      submit.textContent = 'Uploading picture…';
      await putFile(upload.uploadUrl, upload.fields, avatarFile);
      submit.textContent = 'Saving…';
      data = await request('/profile/avatar', {
        method: 'POST',
        body: JSON.stringify({ key: upload.key, contentType: avatarFile.type, size: avatarFile.size, displayName, about })
      });
    } else {
      const profileUpdate = { displayName, about };
      if (profileAvatarRemoveRequested || avatarUrl !== profileInitialAvatarUrl) {
        profileUpdate.avatarUrl = avatarUrl;
      }
      data = await request('/profile', {
        method: 'PATCH', body: JSON.stringify(profileUpdate)
      });
    }
    state.user = data.user;
    profileDialog.close();
    renderShell();
    notify(data.cleanupWarning
      ? 'Profile updated, but an old profile image could not be removed.'
      : 'Profile updated.');
  } catch (error) {
    feedback.textContent = error.message;
    feedback.classList.add('error');
  } finally {
    if (form.isConnected) {
      submit.disabled = false;
      submit.textContent = originalLabel;
    }
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  const clientMessageId = crypto.randomUUID();
  socketEmitAck('message:send', {
    conversationId: state.activeId, text, clientMessageId
  }).then((result) => {
    if (!result?.ok) {
      input.value = text;
      notify(result?.error || 'Message was not sent.', true);
    }
  }).catch(() => {
    input.value = text;
    notify('Connection lost. Your message was not sent; retry when reconnected.', true);
  });
}

function onTyping() {
  const text = document.getElementById('message-input').value;
  if (!text) {
    stopTyping();
    return;
  }
  if (!state.typingActive) {
    socketEmit('typing', { conversationId: state.activeId, isTyping: true });
    state.typingActive = true;
  }
  clearTimeout(state.typingTimer);
  const conversationId = state.activeId;
  state.typingTimer = setTimeout(() => stopTyping(conversationId), 1600);
}

function stopTyping(conversationId = state.activeId) {
  clearTimeout(state.typingTimer);
  state.typingTimer = null;
  if (state.typingActive && conversationId) {
    socketEmit('typing', { conversationId, isTyping: false });
  }
  state.typingActive = false;
}

function socketEmit(event, data) {
  if (state.socket?.connected) state.socket.emit(event, data);
}

function socketEmitAck(event, data, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!state.socket?.connected) return reject(new Error('Not connected.'));
    state.socket.timeout(timeoutMs).emit(event, data, (error, response) => error ? reject(error) : resolve(response));
  });
}

function joinSocketConversation(conversationId, announce = false) {
  return new Promise((resolve, reject) => {
    if (!state.socket?.connected) return reject(new Error('You are offline. Reconnect and try again.'));
    state.socket.emit('conversation:join', { conversationId, announce }, (result) => {
      if (result?.ok) resolve();
      else reject(new Error(result?.error || 'Could not join conversation.'));
    });
  });
}

function loadSocketClient() {
  if (window.io) return Promise.resolve();
  if (!socketClientPromise) {
    socketClientPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('./vendor/socket.io.min.js', document.baseURI);
      script.async = true;
      script.onload = () => window.io ? resolve() : reject(new Error('Realtime client did not initialize.'));
      script.onerror = () => reject(new Error('Realtime client could not load.'));
      document.head.append(script);
    });
  }
  return socketClientPromise;
}

async function connectSocket() {
  try {
    await loadSocketClient();
  } catch (error) {
    socketClientPromise = null;
    notify(`${error.message} Check your network and refresh.`, true);
    return;
  }
  if (!state.token || state.socket) return;
  state.socket = window.io(API || location.origin, {
    auth: { token: state.token },
    transports: ['websocket', 'polling']
  });
  let hasConnected = false;
  state.socket.on('connect', () => {
    if (hasConnected && state.activeId) {
      loadMessages(state.activeId, state.pendingAnnouncement === state.activeId);
    }
    else if (state.activeId) {
      const conversationId = state.activeId;
      joinSocketConversation(conversationId, state.pendingAnnouncement === conversationId)
        .then(() => {
          if (state.pendingAnnouncement === conversationId) state.pendingAnnouncement = null;
        })
        .catch((error) => notify(error.message, true));
    }
    hasConnected = true;
  });
  state.socket.on('connect_error', (error) => notify(error.message || 'Realtime connection failed.', true));
  state.socket.on('message:new', (message) => {
    const conversation = state.conversations.find((item) => item._id === message.conversationId);
    if (conversation) {
      conversation.lastMessage = { text: message.text || (message.attachments?.length ? 'Attachment' : ''), createdAt: message.createdAt };
      conversation.lastMessageAt = message.createdAt;
      if (message.conversationId !== state.activeId && message.sender._id !== state.user._id) conversation.unreadCount++;
    }
    if (message.conversationId === state.activeId) {
      if (state.loadingMessageHistory && state.loadingHistoryConversation === message.conversationId) {
        state.pendingLiveMessages.set(message._id, message);
      } else {
        renderMessage(message);
      }
      const box = document.getElementById('messages');
      if (box) box.scrollTop = box.scrollHeight;
      if (message.sender._id !== state.user._id) socketEmit('message:read', { conversationId: state.activeId });
    }
    renderChatList();
  });
  state.socket.on('message:read-update', ({ conversationId, userId }) => {
    if (conversationId !== state.activeId || userId === state.user._id) return;
    document.querySelectorAll('.mine .message-status').forEach((status) => { status.textContent = 'Read'; });
  });
  state.socket.on('message:deleted', ({ conversationId, messageId }) => {
    if (conversationId !== state.activeId) return;
    markMessageDeleted(messageId);
  });
  state.socket.on('conversation:updated', async () => {
    try {
      await refreshConversations({ render: false });
      renderChatList();
      updateActiveChatHeader();
    } catch (error) { notify(error.message, true); }
  });
  state.socket.on('typing', (data) => {
    if (data.conversationId !== state.activeId || data.userId === state.user._id) return;
    state.peerTyping = data.isTyping ? `${data.displayName} is typing…` : '';
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.textContent = state.peerTyping;
  });
  state.socket.on('presence', ({ userId, online }) => {
    if (online) state.online.add(userId); else state.online.delete(userId);
    const person = otherPerson(activeConversation());
    if (person?._id === userId) {
      const status = document.querySelector('.chat-header-info span');
      if (status) status.textContent = online ? 'Online' : `Last seen ${formatTime(person.lastSeenAt || Date.now())}`;
    }
  });
  state.socket.on('call:incoming', handleIncomingCall);
  state.socket.on('call:accept', handleCallAccepted);
  state.socket.on('call:reject', handleCallRejected);
  state.socket.on('call:end', handleCallEnded);
  state.socket.on('call:offer', handleOffer);
  state.socket.on('call:answer', handleAnswer);
  state.socket.on('call:ice', handleIce);
}

async function startCall(callType) {
  const person = otherPerson(activeConversation());
  if (!person) return;
  if (state.call) return notify('A call is already in progress.', true);
  void getIceServers().catch((error) => console.warn('Could not preload call connection settings:', error.message));
  try {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video'
        ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } }
        : false
    });
    const callId = crypto.randomUUID();
    state.call = {
      callId, callType, conversationId: state.activeId, targetUserId: person._id,
      name: person.displayName, localStream: media, remoteStream: null, pc: null,
      pendingCandidates: [], incoming: false, connectedAt: null, timer: null,
      muted: false, cameraOff: false, iceRestartTimer: null
    };
    state.call.timer = setTimeout(() => {
      notify('No answer. The call has ended.');
      endCall(true);
    }, 30_000);
    const result = await socketEmitAck('call:invite', {
      conversationId: state.activeId, callId, callType, targetUserId: person._id
    });
    if (!result?.ok) throw new Error(result?.error || 'Could not reach the other participant.');
    showCallScreen('Ringing…');
  } catch (error) {
    clearTimeout(state.call?.timer);
    state.call?.localStream?.getTracks().forEach((track) => track.stop());
    state.call = null;
    notify(error.message || 'Could not access the microphone or camera.', true);
  }
}

function handleIncomingCall(call) {
  if (state.call) {
    socketEmit('call:reject', {
      conversationId: call.conversationId, callId: call.callId, targetUserId: call.caller._id,
      reason: 'busy'
    });
    return;
  }
  void getIceServers().catch((error) => console.warn('Could not preload call connection settings:', error.message));
  state.call = {
    callId: call.callId, callType: call.callType, conversationId: call.conversationId,
    targetUserId: call.caller._id, name: call.caller.displayName,
    localStream: null, remoteStream: null, pc: null, pendingCandidates: [],
    incoming: true, connectedAt: null, timer: null, muted: false, cameraOff: false,
    iceRestartTimer: null
  };
  document.getElementById('call-label').textContent = 'INCOMING CALL';
  document.getElementById('call-name').textContent = call.caller.displayName;
  document.getElementById('call-kind').textContent = `${call.callType === 'video' ? 'Video' : 'Audio'} call`;
  callDialog.showModal();
  state.call.timer = setTimeout(() => {
    notify('Missed call.');
    endCall(true);
  }, 30_000);
}

document.getElementById('accept-call').addEventListener('click', async () => {
  if (!state.call) return;
  try {
    const call = state.call;
    clearTimeout(call.timer);
    call.timer = null;
    callDialog.close();
    call.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: call.callType === 'video'
        ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } }
        : false
    });
    showCallScreen('Connecting…');
    socketEmit('call:accept', {
      conversationId: call.conversationId, callId: call.callId, targetUserId: call.targetUserId
    });
  } catch (error) {
    notify(error.message || 'Could not access the microphone or camera.', true);
    endCall(false);
  }
});

document.getElementById('reject-call').addEventListener('click', () => {
  if (!state.call) return;
  clearTimeout(state.call.timer);
  socketEmit('call:reject', {
    conversationId: state.call.conversationId, callId: state.call.callId,
    targetUserId: state.call.targetUserId
  });
  callDialog.close();
  state.call = null;
});

async function getIceServers() {
  if (state.iceServers && Date.now() < state.iceServersAt) return state.iceServers;
  if (!state.iceServersPromise) {
    const pending = request('/ice-servers').then((result) => {
      const now = Date.now();
      const turnServer = result.iceServers.find((server) => typeof server.username === 'string');
      const credentialExpiry = turnServer ? Number.parseInt(turnServer.username, 10) * 1000 : Number.NaN;
      state.iceServers = result.iceServers;
      state.iceServersAt = Number.isFinite(credentialExpiry)
        ? Math.max(now, credentialExpiry - 30_000)
        : now + 10 * 60_000;
      return state.iceServers;
    }).finally(() => {
      if (state.iceServersPromise === pending) state.iceServersPromise = null;
    });
    state.iceServersPromise = pending;
  }
  return state.iceServersPromise;
}

async function getPeerConnection() {
  const iceServers = await getIceServers();
  const pc = new RTCPeerConnection({ iceServers });
  const call = state.call;
  call.pc = pc;
  call.localStream.getTracks().forEach((track) => pc.addTrack(track, call.localStream));
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socketEmit('call:ice', {
      conversationId: call.conversationId, targetUserId: call.targetUserId,
      callId: call.callId, candidate
    });
  };
  pc.ontrack = ({ streams }) => {
    call.remoteStream = streams[0];
    const video = document.getElementById('remote-video');
    const audio = document.getElementById('remote-audio');
    const receiver = video || audio;
    if (receiver) {
      receiver.srcObject = call.remoteStream;
      receiver.play().catch(() => setCallStatus('Tap the call screen to enable audio'));
    }
    setCallStatus('Connected');
    startCallTimer();
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected') {
      setCallStatus('Connection interrupted');
      if (!call.iceRestartTimer) {
        call.iceRestartTimer = setTimeout(() => {
          call.iceRestartTimer = null;
          if (state.call === call && pc.connectionState === 'disconnected') restartCallIce();
        }, 5000);
      }
    } else if (pc.connectionState === 'failed') {
      clearTimeout(call.iceRestartTimer);
      call.iceRestartTimer = null;
      setCallStatus('Connection failed');
    } else if (pc.connectionState === 'connected') {
      clearTimeout(call.iceRestartTimer);
      call.iceRestartTimer = null;
      setCallStatus('Connected');
      startCallTimer();
    } else if (pc.connectionState === 'closed') {
      endCall(false);
    }
  };
  return pc;
}

async function handleCallAccepted(data) {
  if (!state.call || data.callId !== state.call.callId) return;
  clearTimeout(state.call.timer);
  state.call.timer = null;
  state.call.targetUserId = data.fromUserId;
  state.call.incoming = false;
  showCallScreen('Connecting…');
  try {
    const pc = await getPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketEmit('call:offer', {
      conversationId: state.call.conversationId, targetUserId: state.call.targetUserId,
      callId: state.call.callId, description: pc.localDescription
    });
  } catch (error) { notify(`Could not establish call: ${error.message}`, true); endCall(true); }
}

async function handleOffer(data) {
  if (!state.call || data.callId !== state.call.callId) return;
  state.call.targetUserId = data.fromUserId;
  try {
    const pc = state.call.pc || await getPeerConnection();
    await pc.setRemoteDescription(data.description);
    await flushCandidates(pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketEmit('call:answer', {
      conversationId: state.call.conversationId, targetUserId: state.call.targetUserId,
      callId: state.call.callId, description: pc.localDescription
    });
  } catch (error) { notify(`Could not answer call: ${error.message}`, true); endCall(true); }
}

async function handleAnswer(data) {
  if (!state.call || data.callId !== state.call.callId || !state.call.pc) return;
  try {
    await state.call.pc.setRemoteDescription(data.description);
    await flushCandidates(state.call.pc);
  } catch (error) { notify(`Could not connect call: ${error.message}`, true); endCall(true); }
}

async function handleIce(data) {
  if (!state.call || data.callId !== state.call.callId) return;
  if (!data.candidate || typeof data.candidate !== 'object') return;
  try {
    const candidate = new RTCIceCandidate(data.candidate);
    if (state.call.pc?.remoteDescription) await state.call.pc.addIceCandidate(candidate);
    else state.call.pendingCandidates.push(candidate);
  } catch (error) { console.warn('ICE candidate rejected:', error.message); }
}

async function flushCandidates(pc) {
  for (const candidate of state.call.pendingCandidates.splice(0)) {
    try { await pc.addIceCandidate(candidate); } catch (error) { console.warn('Queued ICE candidate rejected:', error.message); }
  }
}

function handleCallRejected(data) {
  if (!state.call || data.callId !== state.call.callId) return;
  notify(data.reason === 'busy' ? 'The other person is on another call.' : 'Call declined.');
  endCall(false);
}

function handleCallEnded(data) {
  if (!state.call || data.callId !== state.call.callId) return;
  endCall(false);
}

function showCallScreen(status) {
  const screen = document.getElementById('call-screen');
  if (!screen || !state.call) return;
  const video = state.call.callType === 'video';
  screen.hidden = false;
  screen.innerHTML = `
    <div class="call-top"><strong>${escapeHtml(state.call.name)}</strong><button class="icon-button" id="fullscreen-call" aria-label="Fullscreen">${icon('expand')}</button></div>
    <div class="call-videos">
      <audio id="remote-audio" autoplay></audio>
      ${video ? '<video class="remote-video" id="remote-video" autoplay playsinline></video><video class="local-video" id="local-video" autoplay playsinline muted></video>' : `<div class="call-avatar">${escapeHtml(initials(state.call.name))}</div>`}
    </div>
    <div class="call-status" id="call-status">${escapeHtml(status)}</div>
    <div class="call-controls">
      <button class="call-control" id="toggle-mic" aria-label="Mute microphone" title="Mute microphone">${icon('mic')}</button>
      ${video ? `<button class="call-control" id="toggle-camera" aria-label="Turn camera off" title="Turn camera off">${icon('camera')}</button>` : ''}
      ${video ? `<button class="call-control" id="switch-camera" aria-label="Switch camera" title="Switch camera">${icon('switch')}</button>` : ''}
      <button class="call-control end" id="end-call" aria-label="End call" title="End call">${icon('callEnd', 'call-end-icon')}</button>
    </div>`;
  const localVideo = document.getElementById('local-video');
  if (localVideo && state.call.localStream) localVideo.srcObject = state.call.localStream;
  screen.querySelector('.call-videos').addEventListener('click', () => {
    const audio = document.getElementById('remote-audio');
    if (audio?.srcObject) audio.play().catch(() => notify('Audio playback is blocked by this browser.', true));
  });
  document.getElementById('end-call').addEventListener('click', () => endCall(true));
  document.getElementById('toggle-mic').addEventListener('click', toggleMic);
  document.getElementById('toggle-camera')?.addEventListener('click', toggleCamera);
  document.getElementById('switch-camera')?.addEventListener('click', switchCamera);
  document.getElementById('fullscreen-call').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await screen.requestFullscreen();
      else await document.exitFullscreen();
    } catch { notify('Fullscreen is unavailable in this browser.', true); }
  });
}

function setCallStatus(status) {
  const element = document.getElementById('call-status');
  if (!element) return;
  element.textContent = status;
  if (['Connection failed', 'Connection interrupted'].includes(status) && state.call?.pc) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'link-button';
    retry.textContent = 'Reconnect';
    retry.addEventListener('click', restartCallIce);
    element.append(' · ', retry);
  }
}

async function restartCallIce() {
  const call = state.call;
  if (!call?.pc || call.pc.signalingState !== 'stable') {
    return notify('Call is still negotiating. Please wait and try again.', true);
  }
  try {
    const offer = await call.pc.createOffer({ iceRestart: true });
    await call.pc.setLocalDescription(offer);
    socketEmit('call:offer', {
      conversationId: call.conversationId, targetUserId: call.targetUserId,
      callId: call.callId, description: call.pc.localDescription
    });
    setCallStatus('Reconnecting…');
  } catch (error) { notify(`Could not restart the connection: ${error.message}`, true); }
}

function startCallTimer() {
  if (state.call.connectedAt) return;
  state.call.connectedAt = Date.now();
  state.call.timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.call.connectedAt) / 1000);
    setCallStatus(`Connected · ${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`);
  }, 1000);
}

function toggleMic() {
  if (!state.call?.localStream) return;
  state.call.muted = !state.call.muted;
  state.call.localStream.getAudioTracks().forEach((track) => { track.enabled = !state.call.muted; });
  const button = document.getElementById('toggle-mic');
  button.innerHTML = state.call.muted ? icon('micOff') : icon('mic');
  button.setAttribute('aria-label', state.call.muted ? 'Unmute microphone' : 'Mute microphone');
}

function toggleCamera() {
  if (!state.call?.localStream) return;
  state.call.cameraOff = !state.call.cameraOff;
  state.call.localStream.getVideoTracks().forEach((track) => { track.enabled = !state.call.cameraOff; });
  const button = document.getElementById('toggle-camera');
  button.innerHTML = state.call.cameraOff ? icon('cameraOff') : icon('camera');
  button.setAttribute('aria-label', state.call.cameraOff ? 'Turn camera on' : 'Turn camera off');
}

async function switchCamera() {
  if (!state.call?.localStream) return;
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
    if (devices.length < 2) return notify('No alternate camera is available.');
    const currentId = state.call.localStream.getVideoTracks()[0]?.getSettings().deviceId;
    const next = devices.find((device) => device.deviceId !== currentId) || devices[0];
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: next.deviceId } }, audio: false });
    const newTrack = stream.getVideoTracks()[0];
    const oldTrack = state.call.localStream.getVideoTracks()[0];
    const sender = state.call.pc?.getSenders().find((item) => item.track?.kind === 'video');
    if (sender) await sender.replaceTrack(newTrack);
    if (oldTrack) {
      state.call.localStream.removeTrack(oldTrack);
      oldTrack.stop();
    }
    state.call.localStream.addTrack(newTrack);
    const preview = document.getElementById('local-video');
    if (preview) preview.srcObject = state.call.localStream;
  } catch (error) {
    notify(`Could not switch camera: ${error.message}`, true);
  }
}

function endCall(notifyPeer) {
  const call = state.call;
  if (!call) return;
  if (notifyPeer && call.targetUserId) socketEmit('call:end', {
    conversationId: call.conversationId, callId: call.callId, targetUserId: call.targetUserId
  });
  clearInterval(call.timer);
  clearTimeout(call.timer);
  clearTimeout(call.iceRestartTimer);
  call.localStream?.getTracks().forEach((track) => track.stop());
  call.remoteStream?.getTracks().forEach((track) => track.stop());
  call.pc?.close();
  callDialog.close();
  const screen = document.getElementById('call-screen');
  if (screen) { screen.hidden = true; screen.replaceChildren(); }
  state.call = null;
}

function signOut() {
  state.socket?.disconnect();
  state.socket = null;
  endCall(false);
  stopTyping();
  state.token = null;
  state.user = null;
  state.conversations = [];
  state.activeId = null;
  state.online.clear();
  state.messageLoadGeneration++;
  state.loadingMessageHistory = false;
  state.loadingHistoryConversation = null;
  state.pendingLiveMessages.clear();
  state.iceServers = null;
  state.iceServersAt = 0;
  state.iceServersPromise = null;
  state.pendingAnnouncement = null;
  sessionStorage.removeItem(tokenKey);
  renderAuth();
}

async function startApp() {
  try {
    if (!state.user) {
      const data = await request('/auth/me');
      state.user = data.user;
    }
    const conversationsPromise = refreshConversations();
    void connectSocket();
    await conversationsPromise;
    const inviteToken = inviteFromUrl();
    if (inviteToken) {
      try {
        const invite = await request(`/invitations/${encodeURIComponent(inviteToken)}`);
        const shouldJoin = confirm(`${invite.createdBy.displayName} invited you to a private chat. Join now?`);
        if (shouldJoin) await joinInvitation(inviteToken);
      } catch (error) {
        notify(error.message, true);
        history.replaceState(null, '', location.pathname);
      }
    }
  } catch (error) {
    if (error.status === 401) {
      sessionStorage.removeItem(tokenKey);
      state.token = null;
      state.user = null;
    }
    renderAuth();
    notify(error.message || 'Could not load ConnectX. Check your connection and try again.', true);
  }
}

async function boot() {
  if (!state.token) return renderAuth();
  await startApp();
}

bindDialogControls();
boot();
