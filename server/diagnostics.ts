import { randomBytes } from 'node:crypto';
import { cpus, loadavg, networkInterfaces } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { machineInfo } from './admin-console.ts';
import { z } from 'zod';

export class DiagnosticError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function configureDiagnostics(db: DatabaseSync) {
  let running: Promise<void> | undefined;
  let stopped = false;
  let sampleVersion = 0;
  let cached: { version: number; at: number; histories: ReturnType<typeof readHistories> } | undefined;
  const enabled = () => db.prepare("SELECT 1 FROM admin_records WHERE kind='monitor-settings' AND payload='true'").get() !== undefined;
  async function check() {
    if (running) return running;
    running = (async () => {
      const tiles = db.prepare('SELECT id,title,url FROM tiles ORDER BY id LIMIT 500').all();
      const results: { id: number; url: string; status: number | null; available: boolean; latency: number; error?: string }[] = [];
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(6, tiles.length) }, async () => {
        while (index < tiles.length && !stopped) {
          const tile = tiles[index++];
          const started = performance.now();
          const result = { id: Number(tile.id), url: String(tile.url), status: null as number | null, available: false, latency: 0, error: undefined as string | undefined };
          try {
            const url = new URL(result.url);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
            const options = { redirect: 'manual', signal: AbortSignal.timeout(5000) } as const;
            let response = await fetch(url, { ...options, method: 'HEAD' });
            if (response.status === 405) {
              await response.body?.cancel();
              response = await fetch(url, { ...options, method: 'GET' });
            }
            result.status = response.status;
            result.available = response.status < 500;
            await response.body?.cancel();
          } catch { result.error = 'Connection, timeout, or certificate verification failed.'; }
          result.latency = Math.round(performance.now() - started);
          results.push(result);
        }
      }));
      if (stopped) return;
      const now = new Date().toISOString();
      db.prepare("INSERT INTO admin_records(kind,label,created,payload) VALUES ('monitor-sample','Service checks',?,?)").run(now, JSON.stringify(results));
      db.prepare("DELETE FROM admin_records WHERE kind='monitor-sample' AND created<?").run(new Date(Date.now() - 7 * 86400_000).toISOString());
      sampleVersion++;
    })().finally(() => { running = undefined; });
    return running;
  }
  const timer = setInterval(() => { if (!stopped && enabled()) void check().catch(() => {}); }, 60_000);
  timer.unref();

  function readHistories() {
    const rows = db.prepare("SELECT created,payload FROM admin_records WHERE kind='monitor-sample' AND created>=? ORDER BY id").iterate(new Date(Date.now() - 7 * 86400_000).toISOString());
    type Sample = { at: string; available: boolean; status: number | null; latency: number; error?: string };
    const histories = new Map<string, { history: Sample[]; samples: number; up: number; daySamples: number; dayUp: number }>();
    for (const row of rows) {
      for (const item of JSON.parse(String(row.payload))) {
        const key = JSON.stringify([item.id, item.url]);
        const state = histories.get(key) ?? { history: [], samples: 0, up: 0, daySamples: 0, dayUp: 0 };
        state.samples++;
        state.up += Number(item.available);
        if (Date.parse(String(row.created)) >= Date.now() - 86400_000) {
          state.daySamples++; state.dayUp += Number(item.available);
        }
        state.history.push({ at: String(row.created), available: item.available, status: item.status, latency: item.latency, error: item.error });
        if (state.history.length > 30) state.history.shift();
        histories.set(key, state);
      }
    }
    return histories;
  }

  function summary() {
    if (!cached || cached.version !== sampleVersion || Date.now() - cached.at > 60_000) {
      cached = { version: sampleVersion, at: Date.now(), histories: readHistories() };
    }
    const histories = cached.histories;
    return {
      enabled: enabled(), running: Boolean(running), intervalSeconds: 60,
      host: { ...machineInfo(), load: loadavg(), cpuTimes: cpus().map(cpu => cpu.times),
        interfaces: Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
          (addresses ?? []).map(address => ({ name, address: address.address, family: address.family, internal: address.internal }))) },
      services: db.prepare('SELECT id,title,url,category FROM tiles ORDER BY category,title').all().map(tile => {
        const state = histories.get(JSON.stringify([tile.id, tile.url]));
        const percentage = (up = 0, count = 0) => count ? Math.round(up / count * 10000) / 100 : null;
        return { ...tile, last: state?.history.at(-1) ?? null, samples: state?.samples ?? 0, daySamples: state?.daySamples ?? 0,
          dayPercent: percentage(state?.dayUp, state?.daySamples), weekPercent: percentage(state?.up, state?.samples), history: state?.history ?? [] };
      }),
    };
  }

  return {
    summary,
    async handle(method: string, path: string, input: unknown) {
      if (path === '/api/admin/diagnostics' && method === 'GET') return summary();
      if (path === '/api/admin/diagnostics/monitor' && method === 'PUT') {
        const settings = z.object({ enabled: z.boolean() }).parse(input);
        db.exec("DELETE FROM admin_records WHERE kind='monitor-settings'");
        db.prepare("INSERT INTO admin_records(kind,label,created,payload) VALUES ('monitor-settings','Monitoring',?,?)").run(new Date().toISOString(), JSON.stringify(settings.enabled));
        if (settings.enabled) void check().catch(() => {});
        return { enabled: settings.enabled };
      }
      if (path === '/api/admin/diagnostics/check' && method === 'POST') {
        await check();
        return summary();
      }
      return undefined;
    },
    close() { stopped = true; clearInterval(timer); },
  };
}

export function speedPayload() { return randomBytes(4 * 1024 * 1024); }
