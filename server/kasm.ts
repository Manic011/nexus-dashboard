import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { kasmPermissions, type KasmLaunch, type KasmSettings } from './kasm-types.ts';

const permission = z.enum(kasmPermissions.map(item => item.id));
const settingsSchema = z.object({
  url: z.string().trim().max(2048),
  enabled: z.boolean(),
  permissions: z.array(permission).max(kasmPermissions.length),
}).strict();

export const kasmInput = z.union([settingsSchema, z.object({ useServerDefault: z.literal(true) }).strict()]);
type Settings = z.infer<typeof settingsSchema>;

export function kasmBaseUrl(input: string, dashboardHosts: string[]) {
  const url = URL.parse(input);
  if (!/^https:\/\//i.test(input) || !url || url.protocol !== 'https:' || url.username || url.password ||
    url.search || url.hash || dashboardHosts.includes(url.hostname.replace(/\.$/, ''))) return null;
  return url.href;
}

export function configureKasm(db: DatabaseSync, environment: string, dashboardHosts: string[]) {
  const defaults: Settings = { url: environment, enabled: Boolean(environment), permissions: [] };
  const lookup = db.prepare("SELECT payload FROM admin_records WHERE kind='kasm-settings' ORDER BY id DESC LIMIT 1");
  const remove = db.prepare("DELETE FROM admin_records WHERE kind='kasm-settings'");
  const insert = db.prepare("INSERT INTO admin_records(kind,label,created,payload) VALUES ('kasm-settings','Kasm',?,?)");

  function read(): KasmSettings {
    const row = lookup.get();
    const metadata = { hasEnvironment: Boolean(environment) };
    if (!row) return { ...defaults, ...metadata, source: environment ? 'environment' : 'default' };
    try {
      const settings = settingsSchema.parse(JSON.parse(String(row.payload)));
      if (!settings.enabled && !settings.url) return { ...settings, ...metadata, source: 'dashboard' };
      const url = kasmBaseUrl(settings.url, dashboardHosts);
      if (url) return { ...settings, url, ...metadata, source: 'dashboard' };
    } catch { /* Invalid restored settings keep the integration disabled. */ }
    return { url: '', enabled: false, permissions: [], ...metadata, source: 'dashboard' };
  }

  function save(settings?: Settings) {
    db.exec('BEGIN IMMEDIATE');
    try {
      remove.run();
      if (settings) insert.run(new Date().toISOString(), JSON.stringify(settings));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return read();
  }

  function launch(destination: string, settings: KasmSettings): KasmLaunch {
    const url = new URL(settings.url);
    url.hash = '/go?' + new URLSearchParams({ kasm_url: new URL(destination).href });
    return { url: url.href, ...(settings.permissions.length ? { permissions: settings.permissions } : {}) };
  }

  return { read, save, launch };
}
