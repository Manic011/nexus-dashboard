import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createSshFixture } from './ssh-fixture.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/index.ts';

test('diagnostic monitoring and SSH sessions enforce access, fingerprints and owner isolation', { timeout: 30_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'stackjetty-diagnostics-'));
  const previousSsh = process.env.NEXUS_SSH;
  process.env.NEXUS_SSH = 'on';
  const { server: sshServer, fingerprint, received, input } = createSshFixture();
  const keyboard = createSshFixture(false, 'keyboard-interactive');
  const service = createServer((_req, res) => { res.writeHead(401); res.end(); });
  const origin = 'http://127.0.0.1';
  const app = createApp(directory, 'dist', origin, 'fixture-token');
  let cookie = '';
  let address = '';
  async function request(path: string, method = 'GET', input?: object) {
    return fetch(address + '/api/' + path, { method, headers: { cookie, origin, 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(input ?? {}) });
  }
  try {
    sshServer.listen(0, '127.0.0.1'); await once(sshServer, 'listening');
    keyboard.server.listen(0, '127.0.0.1'); await once(keyboard.server, 'listening');
    service.listen(0, '127.0.0.1'); await once(service, 'listening');
    app.listen(0, '127.0.0.1'); await once(app, 'listening');
    const binding = app.address(); assert.ok(binding && typeof binding !== 'string');
    address = 'http://127.0.0.1:' + binding.port;
    assert.equal((await request('admin/diagnostics')).status, 401);
    const password = 'fixture-dashboard-password';
    const setup = await request('setup', 'POST', { username: 'admin', password, token: 'fixture-token' });
    cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const adminCookie = cookie;
    const serviceAddress = service.address(); assert.ok(serviceAddress && typeof serviceAddress !== 'string');
    await request('tiles', 'POST', { title: 'Authenticated service', description: '', category: 'General', openMode: 'new-tab', url: 'http://127.0.0.1:' + serviceAddress.port });
    assert.equal((await request('admin/diagnostics/check', 'POST')).status, 200);
    const summary = await (await request('admin/diagnostics')).json();
    assert.equal(summary.services[0].last.status, 401);
    assert.equal(summary.services[0].dayPercent, 100);
    assert.equal(summary.services[0].openMode, 'new-tab');
    assert.equal(summary.enabled, false);
    const sshAddress = sshServer.address(); assert.ok(sshAddress && typeof sshAddress !== 'string');
    const host = { name: 'Fixture machine', host: '127.0.0.1', port: sshAddress.port, username: 'fixture', fingerprint };
    const saved = await (await request('admin/diagnostics/ssh/hosts', 'POST', host)).json();
    const unpinned = await (await request('admin/diagnostics/ssh/hosts', 'POST', { ...host, fingerprint: '' })).json();
    const signIn = { hostId: unpinned.id, authentication: 'password', password: 'fixture-password' };
    assert.equal((await request('admin/diagnostics/ssh/connect', 'POST', signIn)).status, 409);
    const trustPath = 'admin/diagnostics/ssh/hosts/' + unpinned.id;
    const observed = await request(trustPath + '/probe', 'POST');
    assert.equal(observed.status, 200);
    assert.deepEqual(await observed.json(), { fingerprint });
    assert.equal((await request(trustPath + '/trust', 'POST', { fingerprint })).status, 200);
    assert.equal((await request(trustPath + '/trust', 'POST', { fingerprint: 'SHA256:' + 'A'.repeat(43) })).status, 409);
    const trustedConnection = await request('admin/diagnostics/ssh/connect', 'POST', signIn);
    assert.equal(trustedConnection.status, 200);
    await request('admin/diagnostics/ssh/' + (await trustedConnection.json()).id, 'DELETE');
    const wrong = await (await request('admin/diagnostics/ssh/hosts', 'POST', { ...host, fingerprint: 'SHA256:' + 'A'.repeat(43) })).json();
    assert.equal((await request('admin/diagnostics/ssh/connect', 'POST', { hostId: wrong.id, password: 'fixture-password' })).status, 502);
    assert.equal((await request('admin/diagnostics/ssh/connect', 'POST', { hostId: saved.id, authentication: 'password', password: 'incorrect' })).status, 502);
    const keyboardAddress = keyboard.server.address(); assert.ok(keyboardAddress && typeof keyboardAddress !== 'string');
    const keyboardHost = await (await request('admin/diagnostics/ssh/hosts', 'POST', {
      ...host, name: 'PAM fixture', port: keyboardAddress.port, fingerprint: keyboard.fingerprint,
    })).json();
    const keyboardConnection = await request('admin/diagnostics/ssh/connect', 'POST', {
      hostId: keyboardHost.id, authentication: 'password', password: 'fixture-password',
    });
    assert.equal(keyboardConnection.status, 200);
    await request('admin/diagnostics/ssh/' + (await keyboardConnection.json()).id, 'DELETE');
    const connected = await request('admin/diagnostics/ssh/connect', 'POST', { hostId: saved.id, password: 'fixture-password' });
    assert.equal(connected.status, 200);
    const connection = await connected.json();
    const root = 'admin/diagnostics/ssh/' + connection.id;
    const stats = await (await request(root + '/stats')).json();
    assert.equal(stats.cores, 2);
    assert.equal(stats.memory.total, 1024000);
    const listing = await (await request(root + '/files', 'POST', { path: '.' })).json();
    assert.equal(listing.path, '/fixture');
    assert.equal(listing.entries[0].name, 'hello.txt');
    assert.equal((await (await request(root + '/file', 'POST', { path: '/fixture/hello.txt' })).json()).text, 'hello');
    assert.equal((await request(root + '/shell', 'POST')).status, 200);
    const inputReceived = once(input, 'data');
    assert.equal((await request(root + '/input', 'POST', { sequence: 1, data: 'echo hello\n' })).status, 200);
    await inputReceived;
    assert.equal((await request(root + '/input', 'POST', { sequence: 1, data: 'echo hello\n' })).status, 200);
    assert.equal((await request(root + '/input', 'POST', { sequence: 3, data: 'extra\n' })).status, 409);
    assert.match((await (await request(root + '/output', 'POST', { cursor: 0 })).json()).output, /fixture shell ready/);
    assert.equal(received.join(''), 'echo hello\n');
    cookie = '';
    const secondLogin = await request('login', 'POST', { username: 'admin', password });
    cookie = secondLogin.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request(root + '/stats')).status, 404);
    cookie = adminCookie;
    assert.equal((await request('admin/users', 'POST', { username: 'reader', password, role: 'viewer' })).status, 201);
    cookie = '';
    const readerLogin = await request('login', 'POST', { username: 'reader', password });
    cookie = readerLogin.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request('admin/diagnostics')).status, 403);
    assert.equal((await request('admin/diagnostics/speed')).status, 403);
    assert.equal((await request('admin/diagnostics/ssh/connect', 'POST', { hostId: saved.id, password: 'fixture-password' })).status, 403);
    cookie = adminCookie;
    const shellClosed = once(input, 'shell-close');
    await request('logout', 'POST');
    assert.equal((await request(root + '/stats')).status, 401);
    await shellClosed;
    cookie = secondLogin.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request('session/activity', 'POST')).status, 200);
    const idleConnection = await (await request('admin/diagnostics/ssh/connect', 'POST', { hostId: saved.id, password: 'fixture-password' })).json();
    const idleRoot = 'admin/diagnostics/ssh/' + idleConnection.id;
    assert.equal((await request(idleRoot + '/shell', 'POST')).status, 200);
    const idleShellClosed = once(input, 'shell-close');
    const inspection = new DatabaseSync(join(directory, 'nexus.sqlite'));
    try { inspection.exec('UPDATE sessions SET idle_until=0'); } finally { inspection.close(); }
    assert.equal((await (await request('session')).json()).username, null);
    assert.equal((await request('session/activity', 'POST')).status, 401);
    assert.equal((await request(idleRoot + '/stats')).status, 401);
    await idleShellClosed;
  } finally {
    if (previousSsh === undefined) delete process.env.NEXUS_SSH; else process.env.NEXUS_SSH = previousSsh;
    const closed = once(app, 'close'); app.close(); app.closeAllConnections(); await closed;
    sshServer.close(); keyboard.server.close(); service.close(); service.closeAllConnections();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SSH credential entry is rejected for plain HTTP LAN origins', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'stackjetty-insecure-ssh-'));
  const previousSsh = process.env.NEXUS_SSH;
  process.env.NEXUS_SSH = 'on';
  const origin = 'http://dashboard.example.invalid';
  const app = createApp(directory, 'dist', origin, 'fixture-token');
  try {
    app.listen(0, '127.0.0.1'); await once(app, 'listening');
    const bound = app.address(); assert.ok(bound && typeof bound !== 'string');
    const root = 'http://127.0.0.1:' + bound.port + '/api/';
    const headers = { origin, 'Content-Type': 'application/json' };
    const setup = await fetch(root + 'setup', { method: 'POST', headers,
      body: JSON.stringify({ username: 'admin', password: 'fixture-dashboard-password', token: 'fixture-token' }) });
    const cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const response = await fetch(root + 'admin/diagnostics/ssh/connect', {
      method: 'POST', headers: { ...headers, cookie }, body: JSON.stringify({ hostId: 1, password: 'fixture-password' }),
    });
    assert.equal(response.status, 403);
    const localOrigin = new URL(root).origin;
    const catalog = await fetch(root + 'admin/diagnostics/ssh', { headers: { cookie } });
    assert.equal((await catalog.json()).secureTransport, true);
    const attempted = { hostId: 1, authentication: 'password', password: 'fixture-password' };
    const local = await fetch(root + 'admin/diagnostics/ssh/connect', {
      method: 'POST', headers: { ...headers, origin: localOrigin, cookie }, body: JSON.stringify(attempted),
    });
    assert.equal(local.status, 404);
    const proxy = await fetch(root + 'admin/diagnostics/ssh/connect', {
      method: 'POST', headers: { ...headers, origin: localOrigin, cookie, 'X-Forwarded-For': '192.0.2.1' }, body: JSON.stringify(attempted),
    });
    assert.equal(proxy.status, 403);
    const missingOrigin = await fetch(root + 'admin/diagnostics/ssh/connect', {
      method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(attempted),
    });
    assert.equal(missingOrigin.status, 403);
  } finally {
    if (previousSsh === undefined) delete process.env.NEXUS_SSH; else process.env.NEXUS_SSH = previousSsh;
    const closed = once(app, 'close'); app.close(); app.closeAllConnections(); await closed;
    rmSync(directory, { recursive: true, force: true });
  }
});
