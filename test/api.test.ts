import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/index.ts';

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
    const tile = { title: 'Service', url: 'https://example.com', description: '', category: 'General' };
    assert.equal((await request('tiles', 'POST', { ...tile, url: 'javascript:alert(1)' })).status, 400);
    const response = await request('tiles', 'POST', tile);
    assert.equal(response.status, 201);
    const { id } = await response.json();
    assert.equal((await request('tiles/' + id, 'PUT', { ...tile, title: 'Updated' })).status, 200);
    await stop();
    app = createApp(data, 'dist', origin, 'integration-token');
    await start();
    assert.deepEqual(await (await request('tiles')).json(), [{ ...tile, id, title: 'Updated' }]);
    assert.equal((await request('tiles/' + id, 'DELETE')).status, 200);
    assert.deepEqual(await (await request('tiles')).json(), []);
    assert.equal((await request('logout', 'POST')).status, 200);
    assert.equal((await request('tiles')).status, 401);
    assert.equal((await request('login', 'POST', { ...credentials, password: 'wrong password' })).status, 401);
    assert.equal((await request('login', 'POST', credentials)).status, 200);
  } finally {
    await stop();
    rmSync(data, { recursive: true, force: true });
  }
});
