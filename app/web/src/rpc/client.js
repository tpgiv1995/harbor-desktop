export const CONNECTION = {
  disconnected: 'disconnected',
  connecting: 'connecting',
  connected: 'connected',
  error: 'error',
};

const STORAGE_SERVER = 'harbor-web-server';
const STORAGE_TOKEN = 'harbor-web-token';

// Close codes a browser can hand back with no `reason` string attached
// (a server-set reason always wins when present). Named here because
// "code 1006" means nothing to Pat mid-incident; "the connection dropped
// without a clean close" does.
const CLOSE_CODE_HINTS = {
  1000: 'closed normally',
  1001: 'server going away',
  1006: 'connection dropped without a clean close (network or TLS failure before the handshake completed)',
  1011: 'server hit an internal error',
  1013: 'server closed it: client too slow to drain pushes',
  1015: 'TLS handshake failed',
};

// A 64-character hex token is not something anyone should retype on a phone,
// and iOS gives a home-screen web app its own storage container, so pasting it
// once in Safari does NOT carry into the installed app: without this you would
// be asked for it at least twice, and again after any storage eviction.
//
// So the token can arrive in the URL FRAGMENT (#token=...&url=...). A fragment
// is never sent to the server and never lands in an access log, unlike a query
// string. It is consumed once, written to storage, and stripped from the address
// bar immediately so it does not survive in history or a shared screenshot.
export function ingestSetupFragment() {
  try {
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw) return null;
    const params = new URLSearchParams(raw);
    const token = params.get('token');
    if (!token) return null;
    const serverUrl = params.get('url') || defaultServerUrl();
    localStorage.setItem(STORAGE_TOKEN, token.trim());
    if (serverUrl) localStorage.setItem(STORAGE_SERVER, serverUrl.trim());
    // Strip it before anything can screenshot, bookmark or share the address.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return { serverUrl, token: token.trim() };
  } catch {
    return null;
  }
}

export function loadSettings() {
  try {
    ingestSetupFragment();
    return {
      serverUrl: localStorage.getItem(STORAGE_SERVER) || defaultServerUrl(),
      token: localStorage.getItem(STORAGE_TOKEN) || '',
    };
  } catch {
    return { serverUrl: '', token: '' };
  }
}

export function saveSettings({ serverUrl, token }) {
  localStorage.setItem(STORAGE_SERVER, serverUrl.trim());
  localStorage.setItem(STORAGE_TOKEN, token.trim());
}

export function defaultServerUrl() {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname } = window.location;
  if (hostname.endsWith('.ts.net')) {
    return `${protocol}//${hostname}`;
  }
  return '';
}

// Ask the server whether it needs a secret at all, instead of assuming it does.
// Over the tailnet the answer is no, because Tailscale authenticated the device
// before the request could arrive, and the token screen never appears. Anywhere
// else the answer is yes and the screen behaves exactly as before.
//
// This is what makes a cold launch from the home screen work: iOS gives the
// installed app its OWN storage container, so it starts with no token no matter
// what was pasted into Safari, and the old gate had no way to tell that state
// apart from "not set up yet".
export async function probeAuth(serverUrl) {
  const base = serverUrl || defaultServerUrl();
  if (!base) return { authenticated: false, tokenRequired: true, login: null };
  try {
    const response = await fetch(new URL('/whoami', base).toString(), {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) return { authenticated: false, tokenRequired: true, login: null };
    const body = await response.json();
    return {
      authenticated: Boolean(body?.authenticated),
      tokenRequired: body?.tokenRequired !== false,
      login: body?.login || null,
    };
  } catch {
    // Offline, or a server older than /whoami. Fall back to requiring a token,
    // which is the behaviour that was already there.
    return { authenticated: false, tokenRequired: true, login: null };
  }
}

function wsUrlFromHttp(serverUrl, token) {
  const base = new URL(serverUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws';
  base.search = '';
  if (token) base.searchParams.set('token', token);
  return base.toString();
}

export function createRpcClient({ serverUrl, token, onPush, onConnectionChange }) {
  let ws = null;
  let nextId = 1;
  const pending = new Map();
  let state = CONNECTION.disconnected;
  let reconnectTimer = null;
  let manualClose = false;
  let lastError = null;
  let connectCount = 0;
  // Per-channel subscriptions, additive to the single `onPush` callback above
  // (kept for the sidebar's existing use). The conversation and ask surfaces
  // each need their own push channel (transcript:update) without racing each
  // other for one callback slot.
  const channelListeners = new Map();

  function setState(next, error = null) {
    if (state === next && error === lastError) return;
    state = next;
    lastError = error;
    onConnectionChange?.(next, error);
  }

  function connect() {
    manualClose = false;
    connectCount += 1;
    if (!serverUrl) {
      setState(CONNECTION.error, 'server URL is required');
      return;
    }
    setState(CONNECTION.connecting);
    try {
      ws = new WebSocket(wsUrlFromHttp(serverUrl, token));
    } catch (error) {
      setState(CONNECTION.error, String(error.message || error));
      scheduleReconnect();
      return;
    }
    ws.onopen = () => setState(CONNECTION.connected);
    // onerror never carries a real reason (the WebSocket spec deliberately
    // hides it from the error event for security), and onclose fires right
    // after onerror for every failed connection, so onerror's message was
    // being set and then immediately clobbered back to a bare 'disconnected'
    // before React ever painted it. The CloseEvent itself DOES carry a code
    // and (for a same-origin close) a reason, so onclose is the one place
    // that can report anything specific; onerror is left as a no-op signal.
    ws.onclose = (event) => {
      if (!manualClose) {
        const code = event?.code;
        const reason = event?.reason || CLOSE_CODE_HINTS[code] || `code ${code ?? 'unknown'}`;
        setState(CONNECTION.disconnected, reason);
      }
      scheduleReconnect();
    };
    ws.onerror = () => {};
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'push') {
        onPush?.(message.channel, ...(message.args || []));
        const listeners = channelListeners.get(message.channel);
        if (listeners) for (const fn of listeners) fn(...(message.args || []));
        return;
      }
      if (message.type === 'response') {
        const handler = pending.get(message.id);
        if (!handler) return;
        pending.delete(message.id);
        if (message.error) handler.reject(new Error(message.error));
        else handler.resolve(message.result);
      }
    };
  }

  function disconnect() {
    manualClose = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    for (const [, handler] of pending) handler.reject(new Error('disconnected'));
    pending.clear();
    ws?.close();
    ws = null;
    setState(CONNECTION.disconnected);
  }

  function scheduleReconnect() {
    if (manualClose || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 4000);
  }

  function call(method, payload) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('not connected'));
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, payload }));
    });
  }

  function onChannel(channel, fn) {
    if (!channelListeners.has(channel)) channelListeners.set(channel, new Set());
    channelListeners.get(channel).add(fn);
    return () => channelListeners.get(channel)?.delete(fn);
  }

  return {
    connect,
    disconnect,
    call,
    onChannel,
    getState: () => state,
    getLastError: () => lastError,
    getConnectCount: () => connectCount,
  };
}
