import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/index.ts';
import { planWebScan, webScope } from '../server/web-discovery.ts';

test('setup, authentication, tile CRUD, persistence and logout', async () => {
  const data = mkdtempSync(join(tmpdir(), 'nexus-test-'));
  const origin = 'http://localhost';
  let app = createApp(data, 'dist', origin, 'integration-token');
  let address: string;
  async function start() {
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    const bound = app.address();
    assert.ok(bound && typeof bound !== 'string');
    address = 'http://127.0.0.1:' + bound.port;
  }
  async function stop() {
    if (app.listening) {
      const closed = once(app, 'close');
      app.close();
      app.closeAllConnections();
      await closed;
    }
  }
  let cookie = '';
  const request = (path: string, method = 'GET', body?: object, from = origin) => fetch(address + '/api/' + path, {
    method, headers: { cookie, origin: from, 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const credentials = { username: 'admin', password: 'fixture passphrase', token: 'integration-token' };
  try {
    await start();
    assert.equal((await request('tiles')).status, 401);
    assert.equal((await request('setup', 'POST', credentials, 'http://other.invalid')).status, 403);
    assert.equal((await request('setup', 'POST', { ...credentials, token: 'wrong' })).status, 403);
    const setup = await request('setup', 'POST', credentials);
    assert.equal(setup.status, 200);
    cookie = setup.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request('setup', 'POST', credentials)).status, 409);
    const tile = { title: 'Service', url: 'https://example.com', description: '', category: 'General', tags: ['Media'] };
    assert.equal((await request('tiles', 'POST', { ...tile, url: 'javascript:alert(1)' })).status, 400);
    const response = await request('tiles', 'POST', tile);
    assert.equal(response.status, 201);
    const { id } = await response.json();
    assert.equal((await request('tiles/' + id, 'PUT', { title: 'Updated', url: tile.url, category: tile.category, description: tile.description })).status, 200);
    await stop();
    app = createApp(data, 'dist', origin, 'integration-token');
    await start();
    assert.deepEqual(await (await request('tiles')).json(), [{ ...tile, id, title: 'Updated', openMode: 'default' }]);
    assert.equal((await request('tiles/' + id, 'DELETE')).status, 200);
    assert.deepEqual(await (await request('tiles')).json(), []);
    const snapshot = { version: 1, tiles: [tile, { ...tile, url: 'https://example.com/' }] };
    assert.equal((await request('admin/backup/import', 'POST', { ...snapshot, version: 2 })).status, 400);
    const initialPreview = await (await request('admin/backup/preview', 'POST', snapshot)).json();
    assert.deepEqual(initialPreview.tiles, [tile]);
    assert.equal(initialPreview.skipped, 1);
    assert.deepEqual(await (await request('admin/backup/import', 'POST', snapshot)).json(), { imported: 1, skipped: 1 });
    assert.deepEqual(await (await request('admin/backup/import', 'POST', snapshot)).json(), { imported: 0, skipped: 2 });
    assert.deepEqual(await (await request('admin/backup')).json(), { version: 1, tiles: [{ ...tile, openMode: 'default' }] });
    assert.equal((await (await request('admin/system')).json()).tiles, 1);
    const importedTile = (await (await request('tiles')).json())[0];
    await request('admin/tile-access/' + importedTile.id, 'PUT', { restricted: true, users: [], groups: [] });
    const updatePreview = await (await request('admin/backup/preview', 'POST', snapshot)).json();
    const replacement = { ...tile, title: 'Identified service' };
    assert.equal((await request('admin/backup/import', 'POST', { version: 1, tiles: [replacement], updateUrls: [tile.url] })).status, 409);
    const updated = await (await request('admin/backup/import', 'POST', { version: 1, tiles: [replacement], updateUrls: [tile.url], revision: updatePreview.revision })).json();
    assert.equal(updated.updated, 1);
    const current = (await (await request('tiles')).json())[0];
    assert.equal(current.id, importedTile.id);
    assert.equal(current.title, replacement.title);
    assert.equal((await (await request('admin/console')).json()).tiles[0].access.restricted, true);
    assert.equal((await request('admin/backup/import', 'POST', { version: 1, tiles: [tile], updateUrls: [tile.url], revision: updatePreview.revision })).status, 409);
    const profile = { name: 'Test networks', address: '10.42.0.14', range: '10.42.0.0/24,192.168.1.1', exclude: '', ports: '80,443' };
    assert.equal((await request('admin/discovery/profiles', 'POST', profile)).status, 200);
    await request('admin/discovery/profiles', 'POST', { ...profile, ports: '3000' });
    const profiles = await (await request('admin/discovery/profiles')).json();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].ports, '3000');

    assert.equal((await request('logout', 'POST')).status, 200);
    assert.equal((await request('admin/backup')).status, 401);
    assert.equal((await request('tiles')).status, 401);
    assert.equal((await request('login', 'POST', { ...credentials, password: 'wrong password' })).status, 401);
    const renewed = await request('login', 'POST', credentials);
    assert.equal(renewed.status, 200);
    cookie = renewed.headers.get('set-cookie')!.split(';')[0];
    const administrator = cookie;
    for (const [username, role] of [['member', 'editor'], ['shared', 'viewer']] as const) {
      cookie = administrator;
      const created = await request('admin/users', 'POST', { username, role, password: credentials.password });
      assert.equal(created.status, 201);
      const { id } = await created.json();
      cookie = '';
      const login = await request('login', 'POST', { username, password: credentials.password });
      assert.equal(login.status, 200);
      assert.equal((await login.json()).role, role);
      cookie = login.headers.get('set-cookie')!.split(';')[0];
      const accountCookie = cookie;
      assert.equal((await request('tiles')).status, 200);
      assert.equal((await request('admin/users')).status, 403);
      assert.equal((await request('admin/discovery/mdns', 'POST', {})).status, 403);
      assert.equal((await request('tiles', 'POST', tile)).status, role === 'editor' ? 201 : 403);
      cookie = administrator;
      assert.equal((await request('admin/users/' + id, 'DELETE')).status, 200);
      cookie = accountCookie;
      assert.equal((await request('tiles')).status, 401);
    }
  } finally {
    await stop();
    rmSync(data, { recursive: true, force: true });
  }
});

test('custom scan ranges deduplicate targets and honor exclusions', () => {
  const plan = planWebScan('10.42.0.14', 24, { range: '10.42.0.10-10.42.0.13, 10.42.0.10', exclude: '10.42.0.11-10.42.0.12', ports: '80, 8000-8002, 8001' });
  assert.deepEqual(plan.hosts, ['10.42.0.10', '10.42.0.13']);
  assert.deepEqual(plan.ports, [80, 8000, 8001, 8002]);
  assert.equal(plan.checks, 8);
  assert.deepEqual(planWebScan('10.42.0.14', 24, { range: '10.42.1.10,192.168.1.0/30,10.0.0.1', exclude: '192.168.1.2' }).hosts, ['10.0.0.1', '10.42.1.10', '192.168.1.1']);
  assert.throws(() => planWebScan('10.42.0.14', 24, { range: '8.8.8.8' }), /private/);
  assert.throws(() => planWebScan('10.42.0.14', 24, { range: '10.0.0.0/16' }), /4096/);
  assert.throws(() => planWebScan('10.42.0.14', 24, { range: '10.999.0.1' }), /valid/);
  assert.throws(() => planWebScan('10.42.0.14', 24, { ports: '9-2' }), /ports/);
});

test('web discovery stays inside the selected local range', () => {
  const block = webScope('10.3.19.42', 16);
  assert.equal(block.cidr, '10.3.19.0/24');
  assert.equal(block.hosts.length, 254);
  assert.equal(block.hosts[0], '10.3.19.1');
  assert.equal(block.hosts.at(-1), '10.3.19.254');
  assert.deepEqual(webScope('10.3.19.42', 31).hosts, ['10.3.19.42', '10.3.19.43']);
});