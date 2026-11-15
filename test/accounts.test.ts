import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/index.ts';
import { createSshFixture } from './ssh-fixture.ts';

const password = 'fixture-initial-password';
const replacement = 'fixture-replacement-password';
async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'stackjetty-accounts-'));
  let app = createApp(directory, 'dist', 'http://127.0.0.1', 'fixture-token');
  let base = '';
  async function start() {
    app.listen(0, '127.0.0.1'); await once(app, 'listening');
    const address = app.address(); assert.ok(address && typeof address !== 'string');
    base = 'http://127.0.0.1:' + address.port;
  }
  async function stop() {
    const done = once(app, 'close'); app.close(); app.closeAllConnections(); await done;
  }
  await start();
  t.after(async () => { await stop(); rmSync(directory, { recursive: true, force: true }); });
  const request = (cookie: string, path: string, method = 'GET', data?: object) => fetch(base + '/api/' + path, {
    method, headers: { cookie, origin: base, 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(data ?? {}),
  });
  const setup = await request('', 'setup', 'POST', { username: 'primary', password, token: 'fixture-token' });
  assert.equal(setup.status, 200);
  const root = setup.headers.get('set-cookie')!.split(';')[0];
  async function login(username: string, secret = password) {
    const response = await request('', 'login', 'POST', { username, password: secret });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie')!.split(';')[0];
  }
  async function accounts() { return await (await request(root, 'admin/users')).json() as Record<string, unknown>[]; }
  async function edit(actor: string, username: string, changes: object) {
    const account = (await accounts()).find(account => account.username === username)!;
    return request(actor, 'admin/users/' + account.id, 'PATCH', {
      username, revision: account.revision, role: account.role, mustResetPassword: false, ...changes,
    });
  }
  return { directory, request, root, login, accounts, edit,
    async migrateLegacy() {
      await stop();
      const db = new DatabaseSync(join(directory, 'nexus.sqlite'));
      db.exec(`DROP TRIGGER protect_primary_admin_delete; DROP TRIGGER protect_primary_admin_role;
        ALTER TABLE accounts DROP COLUMN revision; ALTER TABLE accounts DROP COLUMN must_reset_password;
        ALTER TABLE accounts DROP COLUMN vault_username; PRAGMA user_version=6;`);
      db.close();
      app = createApp(directory, 'dist', 'http://127.0.0.1', 'fixture-token');
      await start();
    },
  };
}

test('account hierarchy protects the primary administrator and enforces self-service permissions', async t => {
  const f = await fixture(t);
  await f.request(f.root, 'admin/users', 'POST', { username: 'administrator', password, role: 'admin' });
  await f.request(f.root, 'admin/users', 'POST', { username: 'reader', password, role: 'viewer' });
  const administrator = await f.login('administrator');
  const reader = await f.login('reader');
  const primary = (await f.accounts()).find(account => account.id === 1)!;
  assert.equal(primary.primaryAdmin, true);
  assert.equal(primary.hash, undefined);
  assert.equal((await f.request(f.root, 'admin/users/1', 'DELETE')).status, 403);
  assert.equal((await f.request(administrator, 'admin/users/1', 'DELETE')).status, 403);
  assert.equal((await f.edit(administrator, 'primary', { password: replacement })).status, 403);
  assert.equal((await f.edit(f.root, 'primary', { role: 'viewer', currentPassword: password })).status, 403);
  assert.equal((await f.edit(reader, 'administrator', { role: 'viewer' })).status, 403);
  const self = await (await f.request(reader, 'account')).json();
  assert.equal((await f.request(reader, 'account', 'PATCH', { username: 'reader', revision: self.revision, currentPassword: password, role: 'admin' })).status, 400);
  assert.equal((await f.request(reader, 'account', 'PATCH', { username: 'renamed', revision: self.revision, currentPassword: 'wrong' })).status, 403);
  assert.equal((await f.request(reader, 'account', 'PATCH', { username: 'renamed', revision: self.revision, currentPassword: password, password: replacement })).status, 200);
  assert.equal((await f.request(reader, 'tiles')).status, 401);
  const renamed = await f.login('renamed', replacement);
  assert.equal((await (await f.request(renamed, 'account')).json()).id, self.id);
  assert.equal((await f.edit(administrator, 'renamed', { role: 'editor' })).status, 200);
  assert.equal((await f.request(renamed, 'tiles')).status, 401);
  assert.equal((await f.edit(f.root, 'administrator', { username: 'renamed' })).status, 409);
  const adminId = (await f.accounts()).find(account => account.username === 'administrator')!.id;
  assert.equal((await f.request(f.root, 'admin/users/' + adminId, 'DELETE')).status, 200);
  assert.equal((await f.request(administrator, 'tiles')).status, 401);
  const db = new DatabaseSync(join(f.directory, 'nexus.sqlite'));
  try {
    assert.throws(() => db.exec('DELETE FROM accounts WHERE id=1'), /cannot be deleted/);
    assert.throws(() => db.exec("UPDATE accounts SET role='viewer' WHERE id=1"), /retain administrator/);
  } finally { db.close(); }
});

test('forced password changes gate APIs, revoke sessions, and reject stale account edits', async t => {
  const previousSsh = process.env.NEXUS_SSH;
  process.env.NEXUS_SSH = 'on';
  t.after(() => { if (previousSsh === undefined) delete process.env.NEXUS_SSH; else process.env.NEXUS_SSH = previousSsh; });
  const f = await fixture(t);
  const remote = createSshFixture();
  remote.server.listen(0, '127.0.0.1'); await once(remote.server, 'listening');
  t.after(() => remote.server.close());
  const binding = remote.server.address(); assert.ok(binding && typeof binding !== 'string');
  const created = await f.request(f.root, 'admin/users', 'POST', { username: 'administrator', password, role: 'admin' });
  const id = (await created.json()).id;
  const old = await f.login('administrator');
  const other = await f.login('administrator');
  const machine = await (await f.request(f.root, 'admin/diagnostics/ssh/hosts', 'POST', {
    name: 'Fixture SSH machine', host: '127.0.0.1', port: binding.port, username: 'fixture', fingerprint: remote.fingerprint,
  })).json();
  const connected = await f.request(old, 'admin/diagnostics/ssh/connect', 'POST', { hostId: machine.id, password: 'fixture-password' });
  assert.equal(connected.status, 200);
  const ssh = 'admin/diagnostics/ssh/' + (await connected.json()).id;
  assert.equal((await f.request(old, ssh + '/shell', 'POST')).status, 200);
  const closed = once(remote.input, 'shell-close');
  const revision = (await f.accounts()).find(account => account.id === id)!.revision;
  assert.equal((await f.edit(f.root, 'administrator', { mustResetPassword: true })).status, 200);
  await closed;
  for (const cookie of [old, other]) assert.equal((await f.request(cookie, 'tiles')).status, 401);
  assert.equal((await f.edit(f.root, 'administrator', { revision, role: 'viewer' })).status, 409);
  const limited = await f.login('administrator');
  assert.equal((await (await f.request(limited, 'session')).json()).mustResetPassword, true);
  for (const path of ['tiles', 'admin/users', 'admin/system', 'admin/diagnostics/ssh']) {
    assert.equal((await f.request(limited, path)).status, 403);
  }
  const account = await (await f.request(limited, 'account')).json();
  const change = { username: 'administrator', revision: account.revision, currentPassword: password };
  assert.equal((await f.request(limited, 'account', 'PATCH', change)).status, 400);
  assert.equal((await f.request(limited, 'account', 'PATCH', { ...change, password })).status, 400);
  assert.equal((await f.request(limited, 'account', 'PATCH', { ...change, password: replacement })).status, 200);
  assert.equal((await f.request(limited, 'tiles')).status, 401);
  const fresh = await f.login('administrator', replacement);
  assert.equal((await (await f.request(fresh, 'session')).json()).mustResetPassword, false);
  assert.equal((await f.request(fresh, 'tiles')).status, 200);
});

test('schema six upgrade preserves the original administrator and its vault identity', async t => {
  const f = await fixture(t);
  await f.migrateLegacy();
  const root = await f.login('primary');
  const account = await (await f.request(root, 'account')).json();
  assert.equal(account.primaryAdmin, true);
  assert.equal(account.vaultUsername, 'primary');
  assert.equal((await f.request(root, 'account', 'PATCH', {
    username: 'renamed-primary', revision: account.revision, currentPassword: password,
  })).status, 200);
  const renamed = await f.login('renamed-primary');
  assert.equal((await (await f.request(renamed, 'session')).json()).vaultUsername, 'primary');
  const created = await f.request(renamed, 'admin/users', 'POST', { username: 'primary', password, role: 'viewer' });
  assert.equal(created.status, 201);
  const newAccount = await f.login('primary');
  assert.equal((await (await f.request(newAccount, 'session')).json()).vaultUsername, null);
});
