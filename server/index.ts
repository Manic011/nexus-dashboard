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
  tags: z.array(z.string().trim().min(1).max(32).refine(tag => !tag.includes(','))).max(12).default([])
    .transform(tags => [...new Map(tags.map(tag => [tag.toLowerCase(), tag])).values()]),
});
function readTile({ tags, ...item }: Record<string, unknown>) {
  return { ...item, tags: JSON.parse(String(tags)) as string[] };
}

const backup = z.object({ version: z.literal(1), tiles: z.array(tile).max(500) });
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

export function createApp(data: string, dist: string, origin: string, setupToken?: string, jellyfinConfig?: { baseUrl: string; apiKey: string }) {
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
    if (Number(user_version) > 4) throw new Error('Database requires a newer release.');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }

  const consoleAdmin = configureAdministration(db);
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
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };

    try {
      const path = new URL(req.url ?? '/', origin).pathname;
      const method = req.method;
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
      if (method !== 'GET' && (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/json')) {
        throw new RequestError(403, 'Request origin or content type is invalid.');
      }
      const token = req.headers.cookie?.match(/(?:^|; *)nexus_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      const configured = !!admin.get();
      const authenticated = token ? db.prepare(`
        SELECT accounts.id, accounts.username, accounts.role
        FROM sessions JOIN accounts ON accounts.id=sessions.account_id
        WHERE sessions.token=? AND sessions.expires>?
      `).get(digest(token), Date.now()) : undefined;
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
        db.prepare('DELETE FROM sessions WHERE expires <= ? OR token = ?').run(Date.now(), token ? digest(token) : '');
        db.prepare('INSERT INTO sessions (token, expires, account_id) VALUES (?, ?, ?)').run(digest(session), Date.now() + lifetime * 1000, setup ? 1 : account!.id);
        res.setHeader('Set-Cookie', cookie(session, lifetime));
        return send(200, { setup: false, setupTokenRequired: false, username, role: setup ? 'admin' : account!.role });
      }
      if (!authenticated || !token) throw new RequestError(401, 'Sign in to continue.');
      if (method === 'POST' && path === '/api/logout') {
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
      if (method === 'GET' && path === '/api/tiles') {
        return send(200, db.prepare('SELECT * FROM tiles ORDER BY category COLLATE NOCASE, title COLLATE NOCASE, id').all().filter(item => canSee(item.id)).map(readTile));
      }
      if (method === 'GET' && path === '/api/admin/backup') {
        res.setHeader('Content-Disposition', 'attachment; filename="nexus-dashboard.json"');
        return send(200, { version: 1, tiles: db.prepare('SELECT title, description, url, category, tags FROM tiles ORDER BY id').all().map(readTile) });
      }
      if (method === 'GET' && path === '/api/admin/system') {
        return send(200, {
          ...machineInfo(),
          runtime: process.version,
          platform: process.platform,
          schema: db.prepare('PRAGMA user_version').get()?.user_version,
          tiles: db.prepare('SELECT count(*) AS total FROM tiles').get()?.total,
        });
      }
      if (method === 'POST' && ['/api/admin/backup/preview', '/api/admin/backup/import'].includes(path)) {
        const raw = await body(req, 2 * 1024 * 1024);
        const parsed = backup.extend({ updateUrls: z.array(z.string()).max(500).default([]), revision: z.string().optional() }).safeParse(raw);
        if (!parsed.success) throw new RequestError(400, 'Choose a version 1 Nexus backup containing up to 500 valid tiles.');
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
          const update = db.prepare('UPDATE tiles SET title=?, description=?, category=?, tags=? WHERE id=?');
          const updated = new Set<string>();
          for (const item of updates) {
            const url = new URL(item.url).href;
            if (updated.has(url)) continue;
            updated.add(url);
            for (const row of existing.filter(row => new URL(String(row.url)).href === url)) {
              update.run(item.title, item.description, item.category, JSON.stringify(item.tags), row.id);
            }
          }
          const insert = db.prepare('INSERT INTO tiles(title, description, url, category, tags) VALUES (?, ?, ?, ?, ?)');
          for (const item of available) insert.run(item.title, item.description, item.url, item.category, JSON.stringify(item.tags));
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
        const { title, description, url, category, tags } = parsed.data;
        if (match) {
          if (!canSee(Number(match[1]))) throw new RequestError(404, 'Tile not found.');
          const updated = db.prepare('UPDATE tiles SET title=?, description=?, url=?, category=?, tags=COALESCE(?, tags) WHERE id=?').run(title, description, url, category, Object.hasOwn(input as object, 'tags') ? JSON.stringify(tags) : null, Number(match[1]));
          if (!updated.changes) throw new RequestError(404, 'Tile not found.');
          return send(200, { id: Number(match[1]) });
        }
        const inserted = db.prepare('INSERT INTO tiles(title,description,url,category,tags) VALUES (?,?,?,?,?)').run(title, description, url, category, JSON.stringify(tags));
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
  server.on('close', () => db.close());
  return server;
}

if (import.meta.main) {
  const port = Number(process.env.NEXUS_PORT ?? 3000);
  const host = process.env.NEXUS_HOST ?? '127.0.0.1';
  const origin = new URL(process.env.NEXUS_ORIGIN ?? `http://127.0.0.1:${port}`).origin;
  const { NEXUS_JELLYFIN_URL, NEXUS_JELLYFIN_API_KEY } = process.env;
  const jellyfin = NEXUS_JELLYFIN_URL && NEXUS_JELLYFIN_API_KEY
    ? { baseUrl: NEXUS_JELLYFIN_URL, apiKey: NEXUS_JELLYFIN_API_KEY } : undefined;
  const server = createApp(process.env.NEXUS_DATA ?? 'data', process.env.NEXUS_DIST ?? 'dist', origin, process.env.NEXUS_SETUP_TOKEN, jellyfin);
  server.listen(port, host, () => console.log(`Nexus Dashboard listening on ${host}:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => server.close());
}
