'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { WebSocket } = require('ws');
const { composeServer, assertSafeBind } = require('../../src/server/compose.js');

function call(url, method, payload, options = {}) { return new Promise((resolve, reject) => {
  const ws = new WebSocket(url, options); ws.once('error', reject); ws.once('open', () => ws.send(JSON.stringify({ id: 1, method, payload })));
  ws.once('message', (bytes) => { const message = JSON.parse(bytes); ws.close(); resolve(message); });
}); }

test('real websocket serves sidebar and refuses unauthenticated mutation and local-only method', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-server-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sidebar = { emitter: new EventEmitter(), async start() {}, close() {}, getState: () => ({ model: ['real'] }) };
  const artifacts = { async list() { return { ok: true, artifacts: [] }; }, isServable() { return false; } };
  const icons = { async list() { return { dir, icons: {} }; }, watch() {}, async filePathFor() { return null; }, mimeFor() { return null; } };
  const tasks = { read: async () => ({}), mutate: async () => ({}), subscribe() {}, close() {} };
  const composed = await composeServer({ userDataDir: dir, env: { ...process.env, HARBOR_NO_DAEMON_START: '1', HARBOR_TAILNET_LOGINS: 'none', HARBOR_SESSIOND_DIR: path.join(dir, 'sessiond') }, sidebar, artifacts, icons, tasks });
  const address = await composed.listen({ host: '127.0.0.1', port: 0 }); t.after(() => composed.close());
  const url = `ws://127.0.0.1:${address.port}/ws`;
  assert.deepEqual((await call(url, 'sidebar:get-state')).result, { model: ['real'] });
  assert.match((await call(url, 'session:send', { text: 'danger' })).error, /authentication required.*session:send/);
  assert.match((await call(`${url}?token=${composed.token}`, 'window:minimize')).error, /window:minimize.*local-only/);
});

// The identity is decided on the UPGRADE, so it has to be proven on a real
// handshake and not on a plain GET. `tailscale serve` stamps the same header
// there; here the ws client sets it on the handshake to stand in for serve,
// over loopback, which is the only peer the server will accept it from.
test('a tailnet-identified client mutates with NO token, and the same client without the identity cannot', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-server-tailnet-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sidebar = { emitter: new EventEmitter(), async start() {}, close() {}, getState: () => ({ model: [] }) };
  const artifacts = { async list() { return { ok: true, artifacts: [] }; }, isServable() { return false; } };
  const icons = { async list() { return { dir, icons: {} }; }, watch() {}, async filePathFor() { return null; }, mimeFor() { return null; } };
  const tasks = { read: async () => ({ lists: [] }), mutate: async () => ({ ok: true }), subscribe() {}, close() {} };
  const composed = await composeServer({
    userDataDir: dir,
    env: { ...process.env, HARBOR_NO_DAEMON_START: '1', HARBOR_SESSIOND_DIR: path.join(dir, 'sessiond') },
    allowedTailnetLogins: ['owner@example.com'],
    // This harness stands in for tailscaled, so it declares its own uid as the
    // trusted proxy owner. In production that is the uid tailscaled runs as,
    // and a peer owned by anyone else cannot assert an identity at all.
    trustedPeerUids: [process.getuid()],
    sidebar, artifacts, icons, tasks,
  });
  const address = await composed.listen({ host: '127.0.0.1', port: 0 }); t.after(() => composed.close());
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const identified = { headers: { 'tailscale-user-login': 'owner@example.com' } };

  // `tasks:mutate` is a mutating method, so reaching it at all IS the proof of
  // authentication. No token is supplied anywhere in this call.
  const allowed = await call(url, 'tasks:mutate', { op: { type: 'noop' } }, identified);
  assert.equal(allowed.error, undefined, `tailnet client should be authenticated, got: ${allowed.error}`);

  // Two-sided: identical call, no identity, must still be refused. Without this
  // the test above would pass just as well if authentication were simply off.
  const anonymous = await call(url, 'tasks:mutate', { op: { type: 'noop' } });
  assert.match(anonymous.error, /authentication required/);

  // A login the server does not allow is refused even though serve stamped it.
  const stranger = await call(url, 'tasks:mutate', { op: { type: 'noop' } }, { headers: { 'tailscale-user-login': 'someone@else.com' } });
  assert.match(stranger.error, /authentication required/);

  // Tailnet identity is not a skeleton key: local-only stays refused.
  assert.match((await call(url, 'window:minimize', undefined, identified)).error, /window:minimize.*local-only/);
});

test('/whoami reports the tailnet identity and is never cached', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-server-whoami-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sidebar = { emitter: new EventEmitter(), async start() {}, close() {}, getState: () => ({}) };
  const artifacts = { async list() { return { ok: true, artifacts: [] }; }, isServable() { return false; } };
  const icons = { async list() { return { dir, icons: {} }; }, watch() {}, async filePathFor() { return null; }, mimeFor() { return null; } };
  const tasks = { read: async () => ({}), mutate: async () => ({}), subscribe() {}, close() {} };
  const composed = await composeServer({
    userDataDir: dir,
    env: { ...process.env, HARBOR_NO_DAEMON_START: '1', HARBOR_SESSIOND_DIR: path.join(dir, 'sessiond') },
    allowedTailnetLogins: ['owner@example.com'],
    // This harness stands in for tailscaled, so it declares its own uid as the
    // trusted proxy owner. In production that is the uid tailscaled runs as,
    // and a peer owned by anyone else cannot assert an identity at all.
    trustedPeerUids: [process.getuid()],
    sidebar, artifacts, icons, tasks,
  });
  const address = await composed.listen({ host: '127.0.0.1', port: 0 }); t.after(() => composed.close());
  const base = `http://127.0.0.1:${address.port}/whoami`;

  const identified = await fetch(base, { headers: { 'tailscale-user-login': 'owner@example.com' } });
  // A cached answer here would resurrect the token prompt this removes.
  assert.equal(identified.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await identified.json(), {
    authenticated: true, method: 'tailnet', login: 'owner@example.com', name: null, tokenRequired: false,
  });

  const anonymous = await (await fetch(base)).json();
  assert.equal(anonymous.authenticated, false);
  assert.equal(anonymous.tokenRequired, true);
});

test('bind validation rejects wildcard and unrelated interfaces', () => {
  assert.throws(() => assertSafeBind('0.0.0.0'), /unsafe bind/);
  assert.throws(() => assertSafeBind('192.168.1.10'), /unsafe bind/);
  // A REAL Tailscale address, not the placeholder. This line used to read
  // `assert.equal(assertSafeBind('100.x.y.z'), '100.x.y.z')`, because the
  // publish scrub rewrote the author's tailnet address in the source AND in
  // this assertion, so the test went on agreeing with a check that could no
  // longer match any address at all. Full coverage of the range lives in
  // test/server/safe-bind.test.js.
  // Deliberately NOT any real machine's address: writing a real one back into a
  // test is what gives the scrub something to rewrite, which is the whole cause.
  assert.equal(assertSafeBind('100.100.100.100'), '100.100.100.100');
  assert.throws(() => assertSafeBind('100.x.y.z'), /unsafe bind/);
});
