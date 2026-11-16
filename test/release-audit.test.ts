import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.ts';
import { backupState, restoreState } from '../server/state-backup.ts';

test('release audit: permissions, stale restores, full database recovery, and revoked sessions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-release-'));
  const state = join(directory, 'state');
  const origin = 'https://dashboard.example.invalid';
  const password = 'disposable-fixture-password';
  const kasm = 'https://browser.example.invalid/';
  let app = createApp(state, 'dist', origin, 'fixture-token', undefined, true, kasm);
  let base = '';
  let cookie = '';
  async function start() {
    app.listen(0, '127.0.0.1'); await once(app, 'listening');
    const bound = app.address(); assert.ok(bound && typeof bound !== 'string');
    base = 'http://127.0.0.1:' + bound.port;
  }
  async function stop() {
    if (!app.listening) return;
    const done = once(app, 'close'); app.close(); app.closeAllConnections(); await done;
  }
  const request = (path: string, method = 'GET', input?: object, requestOrigin = origin) => fetch(base + '/api/' + path, {
    method, headers: { cookie, origin: requestOrigin, 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(input ?? {}),
  });
  async function login(username: string) {
    cookie = ""; // Each role represents a separate browser session.
    const response = await request('login', 'POST', { username, password });
    assert.equal(response.status, 200); cookie = response.headers.get('set-cookie')!.split(';')[0]; return cookie;
  }
  const tile = { title: 'Private fixture', url: 'https://service.example.invalid/', category: 'Lab', description: '', tags: ['fixture'] };
  try {
    await start();
    const setup = await request('setup', 'POST', { username: 'administrator', password, token: 'fixture-token' });
    assert.equal(setup.status, 200);
    assert.match(setup.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict; Max-Age=604800; Secure/);
    assert.equal(setup.headers.get('cache-control'), 'no-store');
    cookie = setup.headers.get('set-cookie')!.split(';')[0]; const administrator = cookie;
    const viewer = await (await request('admin/users', 'POST', { username: 'reader', password, role: 'viewer' })).json();
    await request('admin/users', 'POST', { username: 'editor', password, role: 'editor' });
    const created = await (await request('tiles', 'POST', tile)).json();
    const remotePath = 'admin/remote-browser/' + created.id;
    const listing = await (await request('tiles')).json();
    assert.equal(listing[0].remoteBrowser, true);
    const launch = new URL((await (await request(remotePath)).json()).url);
    assert.equal(launch.origin, new URL(kasm).origin);
    assert.ok(launch.hash.startsWith('#/go?'));
    assert.equal(new URLSearchParams(launch.hash.split('?')[1]).get('kasm_url'), tile.url);
    assert.equal((await request('admin/remote-browser/99999')).status, 404);
    assert.equal((await (await request('admin/kasm')).json()).source, 'environment');
    const override = { url: 'https://other-browser.example.invalid/kasm/', enabled: true, permissions: ['clipboard', 'audio'] };
    for (const url of ['http://browser.example.invalid/', 'https://dashboard.example.invalid:444/',
      'https://user:secret@browser.example.invalid/', 'https://browser.example.invalid/?custom=go', 'https://browser.example.invalid/#/cast']) {
      assert.equal((await request('admin/kasm', 'PUT', { ...override, url })).status, 400);
    }
    assert.equal((await request('admin/kasm', 'PUT', override, 'https://untrusted.invalid')).status, 403);
    assert.equal((await request('admin/kasm', 'PUT', override)).status, 200);
    const changedLaunch = await (await request(remotePath)).json();
    assert.equal(new URL(changedLaunch.url).pathname, '/kasm/');
    assert.deepEqual(changedLaunch.permissions, override.permissions);
    assert.equal((await request('admin/kasm', 'PUT', { ...override, enabled: false })).status, 200);
    assert.equal((await request(remotePath)).status, 404);
    assert.equal((await (await request('admin/diagnostics')).json()).services[0].remoteBrowser, false);
    assert.equal((await (await request('tiles')).json())[0].remoteBrowser, undefined);
    assert.equal((await (await request('admin/kasm', 'PUT', { useServerDefault: true })).json()).source, 'environment');
    assert.equal((await request(remotePath)).status, 200);
    const group = await (await request('admin/groups', 'POST', { name: 'Fixture group', users: [viewer.id] })).json();
    await request('admin/tile-access/' + created.id, 'PUT', { restricted: true, users: [], groups: [group.id] });
    const snapshot = await (await request('admin/snapshots', 'POST', { name: 'Restricted baseline' })).json();
    const preview = await (await request('admin/snapshots/' + snapshot.id)).json();
    await request('tiles/' + created.id, 'PUT', { ...tile, title: 'Changed fixture' });
    assert.equal((await request('admin/snapshots/' + snapshot.id, 'POST', { revision: preview.revision })).status, 409);
    assert.equal((await request('tiles', 'POST', tile, 'http://untrusted.invalid')).status, 403);

    const readerSession = await login('reader');
    const readerTiles = await (await request('tiles')).json();
    assert.equal(readerTiles.length, 1);
    assert.equal(readerTiles[0].remoteBrowser, undefined);
    assert.equal((await request(remotePath)).status, 403);
    assert.equal((await request('admin/kasm', 'PUT', override)).status, 403);
    assert.equal((await request('tiles/' + created.id, 'PUT', tile)).status, 403);
    assert.equal((await request('tiles/' + created.id, 'DELETE')).status, 403);
    const adminRoutes = ['users', 'system', 'kasm', 'console', 'backup', 'scans/' + snapshot.id, 'discovery/profiles', 'discovery/interfaces', 'discovery/progress', 'snapshots/' + snapshot.id];
    for (const path of adminRoutes) assert.equal((await request('admin/' + path)).status, 403, path);
    for (const path of ['groups', 'snapshots', 'backup/import', 'backup/preview', 'discovery/plan', 'discovery/web', 'discovery/cancel']) {
      assert.equal((await request('admin/' + path, 'POST', {})).status, 403, path);
    }

    await login('editor');
    assert.deepEqual(await (await request('tiles')).json(), []);
    assert.equal((await request('tiles/' + created.id, 'PUT', tile)).status, 404);
    assert.equal((await request('tiles/' + created.id, 'DELETE')).status, 404);
    assert.equal((await request('admin/tile-access/' + created.id, 'PUT', { restricted: false, users: [], groups: [] })).status, 403);
    cookie = '';
    assert.equal((await request(remotePath)).status, 401);
    assert.equal((await request('tiles')).status, 401);
    assert.equal((await request('admin/backup')).status, 401);
    const asset = await fetch(base + '/.env'); assert.equal(asset.status, 404);
    assert.equal((await fetch(base + '/server/index.ts')).status, 404);

    cookie = administrator;
    assert.equal((await request('admin/kasm', 'PUT', { ...override, enabled: false })).status, 200);
    await request('admin/discovery/profiles', 'POST', { name: 'Generic profile', address: '10.42.0.14', range: '10.42.0.0/24', exclude: '', ports: '80' });
    const archive = join(directory, 'database-backup.sqlite');
    await backupState(join(state, 'nexus.sqlite'), archive);
    assert.equal(existsSync(archive + '-wal'), false, 'Portable backups must not leave WAL sidecars');
    assert.equal(existsSync(archive + '-shm'), false, 'Portable backups must not leave shared-memory sidecars');
    await assert.rejects(backupState(join(state, 'nexus.sqlite'), archive), /already exists/);
    await request('admin/groups/' + group.id, 'DELETE');
    cookie = readerSession;
    assert.deepEqual(await (await request('tiles')).json(), []);
    cookie = administrator;
    await request('admin/users/' + viewer.id, 'DELETE');
    cookie = readerSession;
    assert.equal((await request('tiles')).status, 401);

    const restored = join(directory, 'restored');
    await restoreState(archive, restored);
    await assert.rejects(restoreState(archive, restored), /empty/);
    await stop(); app = createApp(restored, 'dist', origin, 'fixture-token'); await start();
    cookie = administrator;
    assert.equal((await request('tiles')).status, 401, 'Restored sessions must be revoked');
    await login('administrator');
    assert.deepEqual(await (await request('admin/kasm')).json(), {
      ...override, enabled: false, source: 'dashboard', hasEnvironment: false,
    });
    assert.equal((await (await request('admin/console')).json()).groups.length, 1);
    assert.equal((await (await request('admin/discovery/profiles')).json()).length, 1);
    assert.equal((await (await request('admin/console')).json()).backups.length, 1);
    await login('reader');
    assert.equal((await (await request('tiles')).json())[0].title, 'Changed fixture');

    await stop();
    app = createApp(restored, 'dist', origin, 'fixture-token', undefined, false);
    await start();
    cookie = '';
    assert.equal((await request('admin/discovery/interfaces')).status, 401);
    await login('administrator');
    assert.equal((await (await request('admin/system')).json()).discoveryEnabled, false);
    assert.equal((await request(remotePath)).status, 404);
    for (const path of ['interfaces', 'progress', 'profiles']) {
      assert.equal((await request('admin/discovery/' + path)).status, 403, path);
    }
    for (const path of ['plan', 'web', 'mdns', 'cancel', 'profiles']) {
      assert.equal((await request('admin/discovery/' + path, 'POST')).status, 403, path);
    }
    assert.equal((await request('admin/backup/preview', 'POST', { version: 1, tiles: [tile] })).status, 200);
    assert.equal((await (await request('tiles')).json()).length, 1);
  } finally { await stop(); rmSync(directory, { recursive: true, force: true }); }
});

test('release scripts use portable LF line endings', () => {
  assert.ok(!readFileSync('deploy/install.sh', 'utf8').includes('\r'));
  assert.ok(readFileSync('deploy/nexus-dashboard.service', 'utf8').includes('User=nexus-dashboard'));
});
