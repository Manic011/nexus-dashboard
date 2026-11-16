import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:https';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.ts';
import { createTlsFixture } from './tls-fixture.ts';

test('per-service certificate trust monitors LAN HTTPS and rejects rotated certificates before HTTP', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'stackjetty-tls-monitor-'));
  const tls = createTlsFixture(directory);
  let requests = 0;
  let failing = false;
  const endpoint = createServer(tls, (req, res) => {
    requests++;
    res.writeHead(failing ? 503 : req.method === 'HEAD' ? 405 : 401);
    res.end();
  });
  const app = createApp(join(directory, 'state'), 'dist', 'http://127.0.0.1', 'fixture-token');
  let base = '';
  let cookie = '';
  const request = (path: string, method = 'GET', data?: object) => fetch(base + '/api/' + path, {
    method, headers: { cookie, Origin: base, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(data ?? {}),
  });
  try {
    endpoint.listen(0, '127.0.0.1'); await once(endpoint, 'listening');
    app.listen(0, '127.0.0.1'); await once(app, 'listening');
    const binding = app.address(); assert.ok(binding && typeof binding !== 'string');
    const remote = endpoint.address(); assert.ok(remote && typeof remote !== 'string');
    base = 'http://127.0.0.1:' + binding.port;
    const setup = await request('setup', 'POST', { username: 'primary', password: 'fixture-dashboard-password', token: 'fixture-token' });
    cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const rootCookie = cookie;
    const url = 'https://127.0.0.1:' + remote.port + '/';
    const tile = await (await request('tiles', 'POST', { title: 'Local HTTPS', url, category: 'Fixtures', description: '' })).json();
    const second = await (await request('tiles', 'POST', { title: 'Still strict', url, category: 'Fixtures', description: '' })).json();
    const root = 'admin/diagnostics/services/' + tile.id;
    const initial = await (await request('admin/diagnostics/check', 'POST')).json();
    assert.equal(initial.services.find((item: { id: number }) => item.id === tile.id).last.outcome, 'tls-unverified');
    assert.equal(requests, 0);
    const inspection = await request(root + '/certificate', 'POST', { url });
    const read = await inspection.json();
    assert.equal(inspection.status, 200, JSON.stringify(read));
    assert.equal(read.fingerprint, new X509Certificate(tls.cert).fingerprint256);
    assert.equal(requests, 0);
    assert.equal((await request(root + '/tls', 'PUT', { url, fingerprint: new X509Certificate(tls.rotated).fingerprint256 })).status, 409);
    assert.equal((await request(root + '/tls', 'PUT', { url, fingerprint: read.fingerprint })).status, 200);
    const approved = await (await request('admin/diagnostics/check', 'POST')).json();
    const monitored = approved.services.find((item: { id: number }) => item.id === tile.id);
    assert.equal(monitored.last.outcome, 'reachable-pinned');
    assert.equal(monitored.last.status, 401);
    assert.equal(monitored.dayPercent, 100);
    assert.equal(monitored.daySamples, 1);
    assert.equal(monitored.dayExcluded, 1);
    assert.equal(approved.services.find((item: { id: number }) => item.id === second.id).last.outcome, 'tls-unverified');
    assert.equal(requests, 2);
    failing = true;
    const unhealthy = await (await request('admin/diagnostics/check', 'POST')).json();
    assert.equal(unhealthy.services.find((item: { id: number }) => item.id === tile.id).last.outcome, 'http-error');
    endpoint.setSecureContext({ key: tls.key, cert: tls.rotated });
    const before = requests;
    const rotated = await (await request('admin/diagnostics/check', 'POST')).json();
    assert.equal(requests, before);
    assert.equal(rotated.services.find((item: { id: number }) => item.id === tile.id).last.outcome, 'certificate-changed');
    assert.equal(rotated.services.find((item: { id: number }) => item.id === tile.id).last.available, null);
    const current = new X509Certificate(tls.rotated).fingerprint256;
    assert.equal((await request(root + '/tls', 'PUT', { url, fingerprint: current })).status, 200);
    assert.equal((await request(root + '/tls', 'PUT', { url, fingerprint: null })).status, 200);
    const removed = await (await request('admin/diagnostics/check', 'POST')).json();
    assert.equal(removed.services.find((item: { id: number }) => item.id === tile.id).last.outcome, 'tls-unverified');
    assert.equal(requests, before);
    assert.equal((await request(root + '/certificate', 'POST', { url: url + 'changed' })).status, 409);
    await request('admin/users', 'POST', { username: 'reader', password: 'fixture-dashboard-password', role: 'viewer' });
    cookie = '';
    const reader = await request('login', 'POST', { username: 'reader', password: 'fixture-dashboard-password' });
    cookie = reader.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request(root + '/certificate', 'POST', { url })).status, 403);
    assert.equal((await request(root + '/tls', 'PUT', { url, fingerprint: current })).status, 403);
    cookie = rootCookie;
    assert.equal((await request(root + '/tls', 'PUT', { url, fingerprint: current })).status, 200);
    await request('tiles/' + tile.id, 'PUT', { title: 'Changed URL', url: url + 'other', category: 'Fixtures', description: '' });
    const changed = await (await request('admin/diagnostics')).json();
    assert.equal(changed.services.find((item: { id: number }) => item.id === tile.id).certificateTrust, undefined);
  } finally {
    const closed = once(app, 'close'); app.close(); app.closeAllConnections(); await closed;
    const stopped = once(endpoint, 'close'); endpoint.close(); endpoint.closeAllConnections(); await stopped;
    rmSync(directory, { recursive: true, force: true });
  }
});
