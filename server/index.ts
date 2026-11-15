import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { discoverServices, discoveryInterfaces } from './discovery.ts';
import { discoverWebServices, planWebScan, webScope } from './web-discovery.ts';
import { configureAdministration, machineInfo } from './admin-console.ts';
import { createJellyfin } from './jellyfin.ts';
import { configureDiagnostics, DiagnosticError, speedPayload } from './diagnostics.ts';
import { configureSsh } from './ssh-console.ts';

const derive = promisify(scrypt);
const credentials = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(12).max(256) });
const member = credentials.extend({ role: z.enum(['editor', 'viewer']) });
type Role = 'admin' | 'editor' | 'viewer';
type Account = { id: number; username: string; salt: string; hash: string; role: Role };
const tile = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(180),
  url: z.url({ protocol: /^https?$/ }).max(2048).refine(value => {
    const url = new URL(value);
    return !url.username && !url.password;
  }),
  category: z.string().trim().min(1).max(40),
  openMode: z.enum(['default', 'new-tab', 'embedded', 'kasm']).optional(),
  tags: z.array(z.string().trim().min(1).max(32).refine(tag => !tag.includes(','))).max(12).default([])
    .transform(tags => [...new Map(tags.map(tag => [tag.toLowerCase(), tag])).values()]),
});
function readTile({ tags, open_mode, ...item }: Record<string, unknown>) {
  return { ...item, openMode: open_mode, tags: JSON.parse(String(tags)) as string[] };
}

const backup = z.object({ version: z.literal(1), tiles: z.array(tile).max(500) });
const categoryMoves = z.array(z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  url: tile.shape.url,
  from: tile.shape.category,
  category: tile.shape.category,
})).min(1).max(500).refine(moves => new Set(moves.map(move => move.id)).size === moves.length);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const lifetime = 7 * 24 * 60 * 60;
class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function body(req: IncomingMessage, limit = 8192) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw new RequestError(413, 'Request too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new RequestError(400, 'Invalid JSON.');
  }
}

export function createApp(data: string, dist: string, origin: string, setupToken?: string, jellyfinConfig?: { baseUrl: string; apiKey: string }, discoveryEnabled = true, kasmUrl?: string) {
  const kasm = kasmUrl === undefined ? undefined : URL.parse(kasmUrl);
  if (kasmUrl !== undefined && (!kasm || kasm.protocol !== 'https:' || kasm.origin === new URL(origin).origin ||
      kasm.username || kasm.password || kasm.search || kasm.hash)) {
    throw new Error('NEXUS_KASM_URL must be an HTTPS base URL on a separate origin, without credentials, query, or fragment.');
  }
  const jellyfin = createJellyfin(jellyfinConfig);
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(data, 'nexus.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  try {
    const { user_version } = db.prepare('PRAGMA user_version').get()!;
    if (user_version === 0) db.exec(`
      CREATE TABLE admin (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE tiles (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, category TEXT NOT NULL);
      PRAGMA user_version=1;
    `);
    if (Number(user_version) < 2) db.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'viewer'))
      );
      INSERT INTO accounts SELECT id, username, salt, hash, 'admin' FROM admin;
      ALTER TABLE sessions ADD COLUMN account_id INTEGER NOT NULL DEFAULT 1;
      DROP TABLE admin;
      PRAGMA user_version=2;
    `);
    if (Number(user_version) < 3) db.exec(`
      ALTER TABLE tiles ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
      PRAGMA user_version=3;
    `);
    if (Number(user_version) < 4) db.exec(`
      CREATE TABLE admin_records (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, label TEXT NOT NULL, created TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE access_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, members TEXT NOT NULL);
      CREATE TABLE tile_access (tile_id INTEGER PRIMARY KEY REFERENCES tiles(id) ON DELETE CASCADE, policy TEXT NOT NULL);
      PRAGMA user_version=4;
    `);
    if (Number(user_version) < 5) db.exec(`
      ALTER TABLE tiles ADD COLUMN open_mode TEXT NOT NULL DEFAULT 'default'
        CHECK (open_mode IN ('default','new-tab','embedded','kasm'));
      PRAGMA user_version=5;
    `);
    if (Number(user_version) < 6) {
      db.exec('ALTER TABLE sessions ADD COLUMN idle_until INTEGER NOT NULL DEFAULT 0; PRAGMA user_version=6;');
      db.prepare('UPDATE sessions SET idle_until=?').run(Date.now() + 15 * 60_000);
    }
    if (Number(user_version) > 6) throw new Error('Database requires a newer release.');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }

  const consoleAdmin = configureAdministration(db);
  const diagnostics = configureDiagnostics(db, Boolean(kasm));
  const configuredOrigin = new URL(origin);
  const ssh = configureSsh(db, process.env.NEXUS_SSH === 'on',
    configuredOrigin.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(configuredOrigin.hostname));
  const speedTests = new Map<string, number>();
  let scanProgress: { checked: number; total: number } | undefined;
  let discoveryRunning = false;
  let scanCancelled = false;
  let loginAttempts = 0;
  let resetAt = 0;
  const secure = origin.startsWith('https:') ? '; Secure' : '';
  const cookie = (token: string, age: number) => `nexus_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
  const admin = db.prepare("SELECT 1 FROM accounts WHERE role='admin'");
  const lookup = db.prepare('SELECT * FROM accounts WHERE username=?');

  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const frameSources = secure ? 'https:' : 'https: http:';
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; frame-src " + frameSources);
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };

    try {
      const path = new URL(req.url ?? '/', origin).pathname;
      const method = req.method;
      const requestHost = URL.parse('http://' + (req.headers.host ?? ''));
      const loopbackOrigin = requestHost && requestHost.host === req.headers.host &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(requestHost.hostname) &&
        ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') &&
        ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].every(header => req.headers[header] === undefined)
        ? requestHost.origin : undefined;
      const localTransport = Boolean(loopbackOrigin && (!req.headers.origin || req.headers.origin === loopbackOrigin));
      const allowedOrigin = req.headers.origin === origin || Boolean(loopbackOrigin && req.headers.origin === loopbackOrigin);
      if (method === 'GET' && path === '/healthz') {
        db.prepare('SELECT 1').get();
        return send(200, { status: 'ok' });
      }
      if (method === 'GET' && !path.startsWith('/api/')) {
        const asset = /^\/assets\/[\w.-]+\.(js|css)$/.test(path);
        if (path !== '/' && !asset) return send(404, { error: 'Page not found.' });
        const type = asset ? (path.endsWith('.js') ? 'text/javascript' : 'text/css') : 'text/html';
        try {
          const file = readFileSync(join(dist, asset ? path.slice(1) : 'index.html'));
          res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': asset ? 'public, max-age=31536000, immutable' : 'no-cache' });
          res.end(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          send(404, { error: 'File not found.' });
        }
        return;
      }
      if (method !== 'GET' && (!allowedOrigin || req.headers['content-type']?.split(';')[0] !== 'application/json')) {
        throw new RequestError(403, 'Request origin or content type is invalid.');
      }
      const token = req.headers.cookie?.match(/(?:^|; *)nexus_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const configured = !!admin.get();
      const now = Date.now();
      const authenticated = token ? db.prepare(`
        SELECT accounts.id, accounts.username, accounts.role
        FROM sessions JOIN accounts ON accounts.id=sessions.account_id
        WHERE sessions.token=? AND sessions.expires>? AND sessions.idle_until>?
      `).get(digest(token), now, now) : undefined;
      if (method === 'GET' && path === '/api/session') {
        return send(200, { setup: !configured, setupTokenRequired: !configured && !!setupToken, username: authenticated?.username ?? null, role: authenticated?.role ?? null, shared: lookup.get('shared')?.role === 'viewer' });
      }
      if (method === 'POST' && (path === '/api/setup' || path === '/api/login')) {
        const setup = path === '/api/setup';
        if (setup && configured) throw new RequestError(409, 'Setup is complete.');
        if (Date.now() >= resetAt) {
          resetAt = Date.now() + 60_000;
          loginAttempts = 0;
        }
        if (++loginAttempts > 12) throw new RequestError(429, 'Try again in a minute.');
        const input = await body(req);
        const parsed = credentials.safeParse(input);
        if (!parsed.success) throw new RequestError(400, 'Enter a username and a password of 12 to 256 characters.');
        const { username, password } = parsed.data;
        if (setup && username === 'shared') throw new RequestError(400, 'Choose a different administrator username.');
        if (setup && (!setupToken || typeof input.token !== 'string' || !timingSafeEqual(Buffer.from(digest(input.token)), Buffer.from(digest(setupToken))))) {
          throw new RequestError(403, 'Enter the setup token from your server configuration.');
        }
        const account = lookup.get(username) as Account | undefined;
        const salt = setup ? randomBytes(16).toString('hex') : account?.salt ?? 'nexus-login';
        const hash = await derive(password, salt, 64) as Buffer;
        if (setup) {
          const inserted = db.prepare("INSERT OR IGNORE INTO accounts VALUES (1, ?, ?, ?, 'admin')").run(username, salt, hash.toString('hex'));
          if (!inserted.changes) throw new RequestError(409, 'Setup is complete.');
        } else if (!account || !timingSafeEqual(hash, Buffer.from(account.hash, 'hex')) || username !== account.username) {
          throw new RequestError(401, 'Invalid credentials.');
        }
        if (!setup && !(db.prepare('SELECT 1 FROM accounts WHERE id=? AND hash=?').get(account!.id, account!.hash))) {
          throw new RequestError(401, 'Invalid credentials.');
        }
        const session = randomBytes(32).toString('hex');
        if (token) ssh.closeOwner(digest(token));
        db.prepare('DELETE FROM sessions WHERE expires <= ? OR idle_until <= ? OR token = ?').run(now, now, token ? digest(token) : '');
        db.prepare('INSERT INTO sessions (token, expires, account_id, idle_until) VALUES (?, ?, ?, ?)').run(digest(session), now + lifetime * 1000, setup ? 1 : account!.id, now + 15 * 60_000);
        res.setHeader('Set-Cookie', cookie(session, lifetime));
        return send(200, { setup: false, setupTokenRequired: false, username, role: setup ? 'admin' : account!.role });
      }
      if (!authenticated || !token) throw new RequestError(401, 'Sign in to continue.');
      if (method === 'POST' && path === '/api/session/activity') {
        await body(req);
        const timestamp = Date.now();
        const renewed = db.prepare('UPDATE sessions SET idle_until=? WHERE token=? AND expires>? AND idle_until>?')
          .run(timestamp + 15 * 60_000, digest(token), timestamp, timestamp);
        if (!renewed.changes) throw new RequestError(401, 'Sign in to continue.');
        return send(200, {});
      }
      if (method === 'POST' && path === '/api/logout') {
        ssh.closeOwner(digest(token));
        db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));
        res.setHeader('Set-Cookie', cookie('', 0));
        return send(200, {});
      }
      if (path.startsWith('/api/admin/') && authenticated.role !== 'admin') {
        throw new RequestError(403, 'Administrator access is required.');
      }
      if (method !== 'GET' && path.startsWith('/api/tiles') && authenticated.role === 'viewer') {
        throw new RequestError(403, 'Editing access is required.');
      }
      if (path.startsWith('/api/admin/diagnostics')) {
        try {
          if (path === '/api/admin/diagnostics/speed' && (method === 'GET' || method === 'POST')) {
            const owner = digest(token) + method;
            if (Date.now() - (speedTests.get(owner) ?? 0) < 500) throw new DiagnosticError(429, 'Wait a moment before testing again.');
            speedTests.set(owner, Date.now());
            for (const [key, at] of speedTests) if (Date.now() - at > 60_000) speedTests.delete(key);
            if (method === 'POST') {
              const payload = z.object({ payload: z.string().max(4 * 1024 * 1024) }).parse(await body(req, 5 * 1024 * 1024));
              return send(200, { bytes: Buffer.byteLength(payload.payload) });
            }
            res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store, no-transform', 'Content-Length': 4 * 1024 * 1024 });
            res.end(speedPayload());
            return;
          }
          const fileUpload = /^\/api\/admin\/diagnostics\/ssh\/[a-f0-9]{48}\/file-operation$/.test(path);
          if (fileUpload && !localTransport && !secure) throw new RequestError(403, 'SSH file operations require HTTPS or the private SSH tunnel.');
          const input = method === 'GET' || method === 'DELETE' ? undefined : await body(req, fileUpload ? 6 * 1024 * 1024 : 65536);
          const controller = new AbortController();
          res.once('close', () => controller.abort());
          const result = path.startsWith('/api/admin/diagnostics/ssh')
            ? await ssh.handle(method!, path, input, digest(token), localTransport, controller.signal)
            : await diagnostics.handle(method!, path, input);
          if (result === undefined) return send(404, { error: 'Diagnostic endpoint not found.' });
          return send(200, result);
        } catch (error) {
          if (error instanceof DiagnosticError) return send(error.status, { error: error.message });
          if (error instanceof z.ZodError) return send(400, { error: 'Check the diagnostic settings and try again.' });
          if (error instanceof RequestError) throw error;
          return send(502, { error: 'The diagnostic operation failed. Check the connection and remote account permissions.' });
        }
      }
      if (!discoveryEnabled && path.startsWith('/api/admin/discovery/')) {
        throw new RequestError(403, 'Network discovery is disabled in the server configuration.');
      }
      if (method === 'POST' && path === '/api/admin/discovery/cancel') { scanCancelled = true; return send(200, {}); }
      if (method === 'GET' && path === '/api/admin/discovery/progress') return send(200, { progress: scanProgress ?? null });
      if (method === 'GET' && path === '/api/admin/discovery/interfaces') {
        return send(200, discoveryInterfaces().map(item => {
          const { cidr, hosts } = webScope(item.address, Number(item.cidr.split('/')[1]));
          const first = hosts[0];
          const last = hosts[Math.min(15, hosts.length - 1)];
          return { ...item, webCidr: cidr, exampleRange: first === last ? first : first + '-' + last };
        }));
      }
      if (method === 'POST' && ['/api/admin/discovery/mdns', '/api/admin/discovery/web', '/api/admin/discovery/plan'].includes(path)) {
        const input = z.object({ address: z.ipv4(), authorized: z.boolean().optional(), range: z.string().max(2000).optional(), exclude: z.string().max(2000).optional(), ports: z.string().max(2000).optional() }).safeParse(await body(req));
        const selected = input.success && discoveryInterfaces().find(item => item.address === input.data.address);
        if (!selected) throw new RequestError(400, 'Select an IPv4 interface on this server.');
        const prefix = Number(selected.cidr.split('/')[1]);
        let plan;
        try { plan = planWebScan(selected.address, prefix, input.success ? input.data : {}); }
        catch (error) { throw new RequestError(400, (error as Error).message); }
        if (path.endsWith('/plan')) return send(200, { hosts: plan.hosts.length, ports: plan.ports, checks: plan.checks });
        const web = path.endsWith('/web');
        if (web && (!input.success || input.data.authorized !== true)) throw new RequestError(400, 'Confirm authorization for the displayed network range.');
        if (discoveryRunning) throw new RequestError(409, 'A discovery request is already running.');
        discoveryRunning = true;
        scanCancelled = false;
        try {
          if (!web) return send(200, { version: 1, tiles: await discoverServices(selected.address, prefix) });
          const [advertised, probed] = await Promise.all([
            discoverServices(selected.address, Math.max(24, prefix)).catch(() => []),
            discoverWebServices(selected.address, prefix, (checked, total) => { scanProgress = { checked, total }; }, plan, () => scanCancelled),
          ]);
          const allowedHosts = new Set(plan.hosts);
          const allowedPorts = new Set(plan.ports);
          const scoped = advertised.filter(item => {
            const url = new URL(item.url);
            return allowedHosts.has(url.hostname) && allowedPorts.has(Number(url.port || (url.protocol === 'https:' ? 443 : 80)));
          });
          const byUrl = new Map(scoped.map(item => [item.url, { ...item, source: 'mDNS advertisement' }]));
          for (const { identified, ...item } of probed.services) {
            if (identified || !byUrl.has(item.url)) byUrl.set(item.url, item);
          }
          const results = [...byUrl.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
          const scopeKey = digest(JSON.stringify({ address: selected.address, hosts: plan.hosts, ports: plan.ports }));
          const previous = consoleAdmin.previousScan(scopeKey);
          const previousUrls = new Set<string>(previous?.tiles.map((item: { url: string }) => item.url) ?? []);
          const currentUrls = new Set(results.map(item => item.url));
          const comparison = previous && !probed.cancelled && results.length <= 500 ? {
            added: results.filter(item => !previousUrls.has(item.url)).map(item => item.url),
            missing: [...previousUrls].filter(url => !currentUrls.has(url)),
            changed: results.filter(item => {
              const old = previous.tiles.find((entry: { url: string }) => entry.url === item.url);
              return old && (old.title !== item.title || old.source !== item.source);
            }).map(item => item.url),
          } : null;
          const result = { version: 1, scopeKey, comparison, cancelled: probed.cancelled, tiles: results.slice(0, 500), checked: probed.checked, total: probed.total, found: results.length };
          consoleAdmin.recordDiscovery((probed.cancelled ? 'Stopped - ' : 'Complete - ') + (input.data.range?.trim() || plan.cidr) + ' · ' + plan.hosts.length + ' addresses · ' + plan.ports.length + ' ports', result);
          return send(200, result);
        } catch (error) {
          console.error(error);
          throw new RequestError(503, 'Discovery could not run on this interface.');
        } finally {
          scanProgress = undefined;
          discoveryRunning = false;
        }
      }
      if (/^\/api\/admin\/(console|scans|snapshots|groups|tile-access|discovery\/profiles)(?:\/|$)/.test(path)) {
        try {
          const result = consoleAdmin.handle(method, path, method === 'POST' || method === 'PUT' ? await body(req, 65536) : undefined);
          if (result === undefined) throw new RequestError(404, 'Item not found.');
          return send(200, result);
        } catch (error) {
          if (error instanceof z.ZodError) throw new RequestError(400, 'Check the selected values and try again.');
          if (error instanceof Error && error.message === 'Configuration changed') throw new RequestError(409, 'Configuration changed. Open the restore preview again.');
          throw error;
        }
      }
      const canSee = (id: unknown) => consoleAdmin.visible(Number(id), Number(authenticated.id), String(authenticated.role));
      if (method === 'GET' && path === '/api/admin/users') {
        return send(200, db.prepare('SELECT id, username, role FROM accounts ORDER BY id').all());
      }
      if (method === 'POST' && path === '/api/admin/users') {
        const parsed = member.safeParse(await body(req));
        if (!parsed.success) throw new RequestError(400, 'Enter a username, a password of 12 to 256 characters, and an editor or viewer role.');
        const { username, password, role } = parsed.data;
        if (username === 'shared' && role !== 'viewer') throw new RequestError(400, 'Shared access requires the viewer role.');
        const salt = randomBytes(16).toString('hex');
        const hash = await derive(password, salt, 64) as Buffer;
        const result = db.prepare('INSERT OR IGNORE INTO accounts(username, salt, hash, role) VALUES (?, ?, ?, ?)').run(username, salt, hash.toString('hex'), role);
        if (!result.changes) throw new RequestError(409, 'This username is already in use.');
        return send(201, { id: Number(result.lastInsertRowid) });
      }
      const user = /^\/api\/admin\/users\/([1-9]\d{0,14})$/.exec(path);
      if (method === 'DELETE' && user) {
        const id = Number(user[1]);
        const result = db.prepare("DELETE FROM accounts WHERE id=? AND role<>'admin'").run(id);
        if (!result.changes) throw new RequestError(404, 'Editor or viewer account not found.');
        db.prepare('DELETE FROM sessions WHERE account_id=?').run(id);
        return send(200, {});
      }
      if (method === 'GET' && path === '/api/integrations/jellyfin') {
        const urls = db.prepare('SELECT id, url FROM tiles').all();
        const tiles = jellyfin ? urls.filter(item => canSee(item.id) && jellyfin.matches(String(item.url))).map(item => item.id) : [];
        return send(200, tiles.length ? { tiles, ...await jellyfin!.summary() } : { tiles });
      }
      const remote = /^\/api\/admin\/remote-browser\/([1-9]\d{0,14})$/.exec(path);
      if (method === 'GET' && remote) {
        const row = db.prepare('SELECT url FROM tiles WHERE id=?').get(Number(remote[1]));
        if (!kasm || !row) throw new RequestError(404, 'Remote browser is unavailable for this tile.');
        const target = tile.shape.url.safeParse(row.url);
        if (!target.success) throw new RequestError(400, 'The tile needs a valid web URL.');
        const launch = new URL(kasm);
        launch.hash = '/go?' + new URLSearchParams({ kasm_url: new URL(target.data).href });
        return send(200, { url: launch.href });
      }
      if ((method === 'GET' && path === '/api/tiles') || (method === 'PATCH' && path === '/api/tiles/categories')) {
        if (method === 'PATCH') {
          const parsed = categoryMoves.safeParse(await body(req, 2 * 1024 * 1024));
          if (!parsed.success) throw new RequestError(400, 'Choose up to 500 distinct tiles with valid categories.');
          const find = db.prepare('SELECT url, category FROM tiles WHERE id=?');
          const update = db.prepare('UPDATE tiles SET category=? WHERE id=?');
          db.exec('BEGIN IMMEDIATE');
          try {
            for (const move of parsed.data) {
              const current = find.get(move.id);
              if (!current || !canSee(move.id)) throw new RequestError(404, 'Tile not found.');
              if (current.url !== move.url || (current.category !== move.from && current.category !== move.category)) {
                throw new RequestError(409, 'A tile changed while you were editing. Reopen the layout and try again.');
              }
              if (current.category !== move.category) update.run(move.category, move.id);
            }
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        }
        const visible = db.prepare('SELECT * FROM tiles ORDER BY category COLLATE NOCASE, title COLLATE NOCASE, id').all()
          .filter(item => canSee(item.id)).map(readTile);
        return send(200, kasm && authenticated.role === 'admin'
          ? visible.map(item => ({ ...item, remoteBrowser: true })) : visible);
      }
      if (method === 'GET' && path === '/api/admin/backup') {
        res.setHeader('Content-Disposition', 'attachment; filename="stackjetty.json"');
        return send(200, { version: 1, tiles: db.prepare('SELECT title, description, url, category, tags, open_mode FROM tiles ORDER BY id').all().map(readTile) });
      }
      if (method === 'GET' && path === '/api/admin/system') {
        return send(200, {
          ...machineInfo(),
          runtime: process.version,
          platform: process.platform,
          discoveryEnabled,
          schema: db.prepare('PRAGMA user_version').get()?.user_version,
          tiles: db.prepare('SELECT count(*) AS total FROM tiles').get()?.total,
        });
      }
      if (method === 'POST' && ['/api/admin/backup/preview', '/api/admin/backup/import'].includes(path)) {
        const raw = await body(req, 2 * 1024 * 1024);
        const parsed = backup.extend({ updateUrls: z.array(z.string()).max(500).default([]), revision: z.string().optional() }).safeParse(raw);
        if (!parsed.success) throw new RequestError(400, 'Choose a version 1 StackJetty backup containing up to 500 valid tiles.');
        const existing = db.prepare('SELECT * FROM tiles ORDER BY id').all();
        const revision = digest(JSON.stringify(existing));
        const savedUrls = new Set(existing.map(row => new URL(String(row.url)).href));
        const seen = new Set(savedUrls);
        const available = parsed.data.tiles.filter(item => {
          const url = new URL(item.url).href;
          if (seen.has(url)) return false;
          seen.add(url);
          return true;
        });
        const skipped = parsed.data.tiles.length - available.length;
        if (path.endsWith('/preview')) return send(200, { revision, tiles: available, skipped, existing: parsed.data.tiles.filter(item => savedUrls.has(new URL(item.url).href)) });
        const updates = parsed.data.tiles.filter(item => savedUrls.has(new URL(item.url).href) && parsed.data.updateUrls.includes(item.url));
        if (updates.length && parsed.data.revision !== revision) throw new RequestError(409, 'Tiles changed. Preview the import again before updating existing tiles.');
        db.exec('BEGIN IMMEDIATE');
        try {
          const update = db.prepare('UPDATE tiles SET title=?, description=?, category=?, tags=?, open_mode=COALESCE(?, open_mode) WHERE id=?');
          const updated = new Set<string>();
          for (const item of updates) {
            const url = new URL(item.url).href;
            if (updated.has(url)) continue;
            updated.add(url);
            for (const row of existing.filter(row => new URL(String(row.url)).href === url)) {
              update.run(item.title, item.description, item.category, JSON.stringify(item.tags), item.openMode ?? null, row.id);
            }
          }
          const insert = db.prepare('INSERT INTO tiles(title, description, url, category, tags, open_mode) VALUES (?, ?, ?, ?, ?, ?)');
          for (const item of available) insert.run(item.title, item.description, item.url, item.category, JSON.stringify(item.tags), item.openMode ?? 'default');
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return send(200, { imported: available.length, skipped, ...(updates.length ? { updated: new Set(updates.map(item => new URL(item.url).href)).size } : {}) });
      }
      const match = /^\/api\/tiles\/([1-9]\d{0,14})$/.exec(path);
      if (match && !canSee(Number(match[1]))) throw new RequestError(404, 'Tile not found.');
      if ((method === 'POST' && path === '/api/tiles') || (method === 'PUT' && match)) {
        const input: unknown = await body(req);
        const parsed = tile.safeParse(input);
        if (!parsed.success) throw new RequestError(400, 'Enter a title, category, and valid web URL. Use up to 12 tags of 32 characters each.');
        const { title, description, url, category, tags, openMode } = parsed.data;
        if (match) {
          if (!canSee(Number(match[1]))) throw new RequestError(404, 'Tile not found.');
          const updated = db.prepare('UPDATE tiles SET title=?, description=?, url=?, category=?, tags=COALESCE(?, tags), open_mode=COALESCE(?, open_mode) WHERE id=?').run(title, description, url, category, Object.hasOwn(input as object, 'tags') ? JSON.stringify(tags) : null, openMode ?? null, Number(match[1]));
          if (!updated.changes) throw new RequestError(404, 'Tile not found.');
          return send(200, { id: Number(match[1]) });
        }
        const inserted = db.prepare('INSERT INTO tiles(title,description,url,category,tags,open_mode) VALUES (?,?,?,?,?,?)').run(title, description, url, category, JSON.stringify(tags), openMode ?? 'default');
        return send(201, { id: Number(inserted.lastInsertRowid) });
      }
      if (method === 'DELETE' && match) {
        if (!db.prepare('DELETE FROM tiles WHERE id=?').run(Number(match[1])).changes) throw new RequestError(404, 'Tile not found.');
        return send(200, {});
      }
      send(404, { error: 'Endpoint not found.' });
    } catch (error) {
      if (error instanceof RequestError) return send(error.status, { error: error.message });
      console.error(error);
      send(500, { error: 'An internal error occurred.' });
    }
  });
  server.on('close', () => { diagnostics.close(); ssh.close(); db.close(); });
  return server;
}

if (import.meta.main) {
  const port = Number(process.env.NEXUS_PORT ?? 3000);
  const host = process.env.NEXUS_HOST ?? '127.0.0.1';
  const origin = new URL(process.env.NEXUS_ORIGIN ?? `http://127.0.0.1:${port}`).origin;
  const { NEXUS_JELLYFIN_URL, NEXUS_JELLYFIN_API_KEY } = process.env;
  const jellyfin = NEXUS_JELLYFIN_URL && NEXUS_JELLYFIN_API_KEY
    ? { baseUrl: NEXUS_JELLYFIN_URL, apiKey: NEXUS_JELLYFIN_API_KEY } : undefined;
  const discovery = process.env.NEXUS_DISCOVERY;
  if (discovery !== undefined && discovery !== 'on' && discovery !== 'off') {
    throw new Error('NEXUS_DISCOVERY must be on or off.');
  }
  const server = createApp(process.env.NEXUS_DATA ?? 'data', process.env.NEXUS_DIST ?? 'dist', origin, process.env.NEXUS_SETUP_TOKEN, jellyfin, discovery !== 'off', process.env.NEXUS_KASM_URL);
  server.listen(port, host, () => console.log(`StackJetty listening on ${host}:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => server.close());
}
