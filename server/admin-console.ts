import { cpus, freemem, hostname, platform, release, totalmem, uptime } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const ids = z.array(z.number().int().positive()).max(1000);
const rules = z.object({ users: ids, groups: ids, restricted: z.boolean() });
const groupInput = z.object({ name: z.string().trim().min(1).max(64), users: ids });
const named = z.object({ name: z.string().trim().min(1).max(80) });
const empty = { restricted: false, users: [], groups: [] };

export function configureAdministration(db: DatabaseSync) {
  function save(kind: string, label: string, value: unknown) {
    return Number(db.prepare('INSERT INTO admin_records(kind,label,created,payload) VALUES (?,?,?,?)')
      .run(kind, label, new Date().toISOString(), JSON.stringify(value)).lastInsertRowid);
  }

  function list(kind: string) {
    return db.prepare('SELECT id,label,created FROM admin_records WHERE kind=? ORDER BY id DESC').all(kind);
  }

  function load(kind: string, id: number) {
    const row = db.prepare('SELECT payload FROM admin_records WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(String(row.payload)) : undefined;
  }

  function snapshot(label: string) {
    return save('backup', label, {
      tiles: db.prepare('SELECT * FROM tiles ORDER BY id').all(),
      rules: db.prepare('SELECT * FROM tile_access').all(),
      groups: db.prepare('SELECT * FROM access_groups').all(),
    });
  }

  function policy(id: number) {
    const row = db.prepare('SELECT policy FROM tile_access WHERE tile_id=?').get(id);
    return row ? rules.parse(JSON.parse(String(row.policy))) : empty;
  }

  function visible(tileId: number, accountId: number, role: string) {
    if (role === 'admin') return true;
    const access = policy(tileId);
    if (!access.restricted) return true;
    const memberships = db.prepare('SELECT id,members FROM access_groups').all();
    return access.users.includes(accountId) || memberships.some(group =>
      access.groups.includes(Number(group.id)) && ids.parse(JSON.parse(String(group.members))).includes(accountId));
  }

  function recordDiscovery(scope: string, result: object) {
    save('scan', scope, result);
    db.prepare("DELETE FROM admin_records WHERE kind='scan' AND id NOT IN (SELECT id FROM admin_records WHERE kind='scan' ORDER BY id DESC LIMIT 20)").run();
  }

  function handle(method: string | undefined, path: string, input: unknown) {
    if (path === '/api/admin/console' && method === 'GET') {
      return {
        groups: db.prepare('SELECT * FROM access_groups ORDER BY name').all().map(group => ({
          id: group.id, name: group.name, users: JSON.parse(String(group.members)),
        })),
        tiles: db.prepare('SELECT id,title,url,category FROM tiles ORDER BY title').all().map(tile => ({
          ...tile, access: policy(Number(tile.id)),
        })),
        backups: list('backup'),
        scans: list('scan'),
      };
    }
    if (path === '/api/admin/snapshots' && method === 'POST') {
      const { name } = named.parse(input);
      return { id: snapshot(name) };
    }
    if (path === '/api/admin/groups' && method === 'POST') {
      const group = groupInput.parse(input);
      const id = db.prepare('INSERT INTO access_groups(name,members) VALUES (?,?)').run(group.name, JSON.stringify(group.users)).lastInsertRowid;
      return { id: Number(id) };
    }

    const match = /^\/api\/admin\/(scans|snapshots|groups|tile-access)\/([1-9]\d{0,13})$/.exec(path);
    if (!match) return undefined;
    const [, resource, rawId] = match;
    const id = Number(rawId);
    if (resource === 'scans' && method === 'GET') return load('scan', id);
    if (resource === 'snapshots' && method === 'GET') {
      const configuration = load('backup', id);
      return configuration && { tiles: configuration.tiles.length, groups: configuration.groups.length, restricted: configuration.rules.length };
    }
    if (resource === 'snapshots' && method === 'POST') {
      const target = load('backup', id);
      if (!target) return undefined;
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = snapshot('Before restore');
        db.exec('DELETE FROM tile_access; DELETE FROM tiles; DELETE FROM access_groups');
        const tile = db.prepare('INSERT INTO tiles(id,title,description,url,category,tags) VALUES (?,?,?,?,?,?)');
        for (const row of target.tiles) tile.run(row.id, row.title, row.description, row.url, row.category, row.tags);
        const group = db.prepare('INSERT INTO access_groups(id,name,members) VALUES (?,?,?)');
        for (const row of target.groups) group.run(row.id, row.name, row.members);
        const access = db.prepare('INSERT INTO tile_access VALUES (?,?)');
        for (const row of target.rules) access.run(row.tile_id, row.policy);
        db.exec('COMMIT');
        return { previous };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    if (resource === 'groups' && method === 'PUT') {
      const group = groupInput.parse(input);
      return db.prepare('UPDATE access_groups SET name=?,members=? WHERE id=?').run(group.name, JSON.stringify(group.users), id).changes ? {} : undefined;
    }
    if (resource === 'groups' && method === 'DELETE') {
      return db.prepare('DELETE FROM access_groups WHERE id=?').run(id).changes ? {} : undefined;
    }
    if (resource === 'tile-access' && method === 'PUT') {
      const access = rules.parse(input);
      if (!db.prepare('SELECT 1 FROM tiles WHERE id=?').get(id)) return undefined;
      if (access.restricted) db.prepare('INSERT OR REPLACE INTO tile_access VALUES (?,?)').run(id, JSON.stringify(access));
      else db.prepare('DELETE FROM tile_access WHERE tile_id=?').run(id);
      return {};
    }
  }

  return { visible, handle, recordDiscovery };
}

export function machineInfo() {
  return {
    hostname: hostname(), os: platform(), kernel: release(), architecture: process.arch,
    cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemory: totalmem(), freeMemory: freemem(),
    machineUptime: uptime(), serviceUptime: process.uptime(), serviceMemory: process.memoryUsage().rss,
  };
}
