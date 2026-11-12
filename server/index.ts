import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const derive = promisify(scrypt);
const credentials = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(12).max(256) });
const tile = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(180),
  url: z.url({ protocol: /^https?$/ }).max(2048).refine(value => {
    const url = new URL(value);
    return !url.username && !url.password;
  }),
  category: z.string().trim().min(1).max(40),
});
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

export function createApp(data: string, dist: string, origin: string, setupToken?: string) {
  mkdirSync(data, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(data, 'nexus.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  try {
    const { user_version } = db.prepare('PRAGMA user_version').get()!;
    if (user_version === 0) db.exec(`
      CREATE TABLE admin (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE tiles (id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, category TEXT NOT NULL);
      PRAGMA user_version=1;
    `);
    if (Number(user_version) > 1) throw new Error('Database requires a newer release.');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }

  let loginAttempts = 0;
  let resetAt = 0;
  const secure = origin.startsWith('https:') ? '; Secure' : '';
  const cookie = (token: string, age: number) => `nexus_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
  const admin = db.prepare('SELECT username, salt, hash FROM admin WHERE id=1');

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
      const account = admin.get() as { username: string; salt: string; hash: string } | undefined;
      const authenticated = token && db.prepare('SELECT 1 FROM sessions WHERE token=? AND expires>?').get(digest(token), Date.now());
      if (method === 'GET' && path === '/api/session') {
        return send(200, { setup: !account, setupTokenRequired: !account && !!setupToken, username: authenticated ? account?.username : null });
      }
      if (method === 'POST' && (path === '/api/setup' || path === '/api/login')) {
        const setup = path === '/api/setup';
        if (setup && account) throw new RequestError(409, 'Setup is complete.');
        if (Date.now() >= resetAt) {
          resetAt = Date.now() + 60_000;
          loginAttempts = 0;
        }
        if (++loginAttempts > 12) throw new RequestError(429, 'Try again in a minute.');
        const input = await body(req);
        const parsed = credentials.safeParse(input);
        if (!parsed.success) throw new RequestError(400, 'Enter a username and a password of 12 to 256 characters.');
        const { username, password } = parsed.data;
        if (setup && (!setupToken || typeof input.token !== 'string' || !timingSafeEqual(Buffer.from(digest(input.token)), Buffer.from(digest(setupToken))))) {
          throw new RequestError(403, 'Enter the setup token from your server configuration.');
        }
        const salt = setup ? randomBytes(16).toString('hex') : account?.salt ?? 'nexus-login';
        const hash = await derive(password, salt, 64) as Buffer;
        if (setup) {
          const inserted = db.prepare('INSERT OR IGNORE INTO admin VALUES (1, ?, ?, ?)').run(username, salt, hash.toString('hex'));
          if (!inserted.changes) throw new RequestError(409, 'Setup is complete.');
        } else if (!account || !timingSafeEqual(hash, Buffer.from(account.hash, 'hex')) || username !== account.username) {
          throw new RequestError(401, 'Invalid credentials.');
        }
        const session = randomBytes(32).toString('hex');
        db.prepare('DELETE FROM sessions WHERE expires <= ? OR token = ?').run(Date.now(), token ? digest(token) : '');
        db.prepare('INSERT INTO sessions VALUES (?, ?)').run(digest(session), Date.now() + lifetime * 1000);
        res.setHeader('Set-Cookie', cookie(session, lifetime));
        return send(200, { setup: false, setupTokenRequired: false, username });
      }
      if (!authenticated || !token) throw new RequestError(401, 'Sign in to continue.');
      if (method === 'POST' && path === '/api/logout') {
        db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));
        res.setHeader('Set-Cookie', cookie('', 0));
        return send(200, {});
      }
      if (method === 'GET' && path === '/api/tiles') {
        return send(200, db.prepare('SELECT * FROM tiles ORDER BY category COLLATE NOCASE, title COLLATE NOCASE, id').all());
      }
      if (method === 'GET' && path === '/api/admin/backup') {
        res.setHeader('Content-Disposition', 'attachment; filename="nexus-dashboard.json"');
        return send(200, { version: 1, tiles: db.prepare('SELECT title, description, url, category FROM tiles ORDER BY id').all() });
      }
      if (method === 'GET' && path === '/api/admin/system') {
        return send(200, {
          runtime: process.version,
          platform: process.platform,
          schema: db.prepare('PRAGMA user_version').get()?.user_version,
          tiles: db.prepare('SELECT count(*) AS total FROM tiles').get()?.total,
        });
      }
      if (method === 'POST' && ['/api/admin/backup/preview', '/api/admin/backup/import'].includes(path)) {
        const parsed = backup.safeParse(await body(req, 2 * 1024 * 1024));
        if (!parsed.success) throw new RequestError(400, 'Choose a version 1 Nexus backup containing up to 500 valid tiles.');
        const existing = db.prepare('SELECT url FROM tiles').all();
        const seen = new Set(existing.map(row => new URL(String(row.url)).href));
        const available = parsed.data.tiles.filter(item => {
          const url = new URL(item.url).href;
          if (seen.has(url)) return false;
          seen.add(url);
          return true;
        });
        const skipped = parsed.data.tiles.length - available.length;
        if (path.endsWith('/preview')) return send(200, { tiles: available, skipped });
        db.exec('BEGIN IMMEDIATE');
        try {
          const insert = db.prepare('INSERT INTO tiles(title, description, url, category) VALUES (?, ?, ?, ?)');
          for (const item of available) insert.run(item.title, item.description, item.url, item.category);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return send(200, { imported: available.length, skipped });
      }
      const match = /^\/api\/tiles\/([1-9]\d{0,14})$/.exec(path);
      if ((method === 'POST' && path === '/api/tiles') || (method === 'PUT' && match)) {
        const parsed = tile.safeParse(await body(req));
        if (!parsed.success) throw new RequestError(400, 'Enter a title, category, and HTTP or HTTPS URL without credentials.');
        const { title, description, url, category } = parsed.data;
        if (match) {
          const updated = db.prepare('UPDATE tiles SET title=?, description=?, url=?, category=? WHERE id=?').run(title, description, url, category, Number(match[1]));
          if (!updated.changes) throw new RequestError(404, 'Tile not found.');
          return send(200, { id: Number(match[1]) });
        }
        const inserted = db.prepare('INSERT INTO tiles(title,description,url,category) VALUES (?,?,?,?)').run(title, description, url, category);
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
  const server = createApp(process.env.NEXUS_DATA ?? 'data', process.env.NEXUS_DIST ?? 'dist', origin, process.env.NEXUS_SETUP_TOKEN);
  server.listen(port, host, () => console.log(`Nexus Dashboard listening on ${host}:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => server.close());
}
