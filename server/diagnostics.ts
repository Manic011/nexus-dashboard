import { randomBytes } from 'node:crypto';
import { cpus, loadavg, networkInterfaces } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { machineInfo } from './admin-console.ts';
import { z } from 'zod';
import { probePinnedCertificate, readMonitorCertificate } from './monitor-certificates.ts';

export class DiagnosticError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

type Outcome = 'reachable' | 'reachable-pinned' | 'http-error' | 'tls-unverified' | 'certificate-changed' | 'timeout' | 'connection-failed' | 'unclassified';
type Result = { id: number; url: string; status: number | null; available: boolean | null; outcome: Outcome; latency: number; error?: string };

export function classifyProbeFailure(error: unknown): Pick<Result, 'outcome' | 'available' | 'error'> {
  const failure = error as { name?: string; code?: string; cause?: { code?: string } } | null;
  const code = failure?.cause?.code ?? failure?.code ?? '';
  if (code === 'STACKJETTY_CERT_CHANGED') {
    return { outcome: 'certificate-changed', available: null, error: 'The certificate changed. Review the new certificate before trusting it for monitoring.' };
  }
  if (/^(?:CERT_|ERR_TLS_CERT_|DEPTH_ZERO_SELF_SIGNED_CERT$|SELF_SIGNED_CERT_IN_CHAIN$|UNABLE_TO_(?:VERIFY|GET_ISSUER_CERT))/.test(code)) {
    return { outcome: 'tls-unverified', available: null, error: 'The HTTPS endpoint answered, but StackJetty could not verify its certificate.' };
  }
  if (failure?.name === 'TimeoutError' || code.endsWith('_TIMEOUT') || code === 'ETIMEDOUT') {
    return { outcome: 'timeout', available: false, error: 'The request timed out from the StackJetty server.' };
  }
  const message = code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'The StackJetty server could not resolve this hostname.'
    : code === 'ECONNREFUSED' ? 'The destination refused the connection from the StackJetty server.'
    : 'The StackJetty server could not complete the connection.';
  return { outcome: 'connection-failed', available: false, error: message };
}

async function probe(url: URL, method: 'HEAD' | 'GET', fingerprint?: string) {
  if (fingerprint) return probePinnedCertificate(url, method, fingerprint);
  const response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (response.body) void response.body.cancel().catch(() => {});
  return response.status;
}

export function configureDiagnostics(db: DatabaseSync, remoteBrowser = false) {
  let running: Promise<void> | undefined;
  let stopped = false;
  let sampleVersion = 0;
  let cached: { version: number; at: number; histories: ReturnType<typeof readHistories> } | undefined;
  const enabled = () => db.prepare("SELECT 1 FROM admin_records WHERE kind='monitor-settings' AND payload='true'").get() !== undefined;
  const trustInput = z.object({ url: z.url({ protocol: /^https$/ }).max(2048),
    fingerprint: z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/).nullable() }).strict();
  const trustQuery = db.prepare("SELECT payload FROM admin_records WHERE kind='monitor-certificate' AND label=? ORDER BY id DESC LIMIT 1");
  function certificateTrust(id: number, url: string) {
    const row = trustQuery.get(String(id));
    if (!row) return undefined;
    try {
      const saved = trustInput.parse(JSON.parse(String(row.payload)));
      return saved.url === new URL(url).href && saved.fingerprint ? { fingerprint: saved.fingerprint } : undefined;
    } catch { return undefined; }
  }
  async function check() {
    if (running) return running;
    running = (async () => {
      const tiles = db.prepare('SELECT id,title,url FROM tiles ORDER BY id LIMIT 500').all();
      const results: Result[] = [];
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(6, tiles.length) }, async () => {
        while (index < tiles.length && !stopped) {
          const tile = tiles[index++];
          const started = performance.now();
          const result: Result = { id: Number(tile.id), url: String(tile.url), status: null, available: false, outcome: 'connection-failed', latency: 0 };
          try {
            const url = new URL(result.url);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
            const fingerprint = url.protocol === 'https:' ? certificateTrust(result.id, result.url)?.fingerprint : undefined;
            const head = await probe(url, 'HEAD', fingerprint);
            result.status = head === 405 || head >= 500 ? await probe(url, 'GET', fingerprint) : head;
            result.available = result.status < 500;
            result.outcome = result.available ? fingerprint ? 'reachable-pinned' : 'reachable' : 'http-error';
            if (!result.available) result.error = 'The endpoint replied, but returned HTTP ' + result.status + '.';
          } catch (error) { Object.assign(result, classifyProbeFailure(error)); }
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
    type Sample = Omit<Result, 'id' | 'url'> & { at: string };
    const histories = new Map<string, { history: Sample[]; samples: number; up: number; daySamples: number; dayUp: number; excluded: number; dayExcluded: number }>();
    for (const row of rows) {
      for (const item of JSON.parse(String(row.payload))) {
        const key = JSON.stringify([item.id, item.url]);
        const state = histories.get(key) ?? { history: [], samples: 0, up: 0, daySamples: 0, dayUp: 0, excluded: 0, dayExcluded: 0 };
        // Older samples could not distinguish a certificate failure or an unsupported HEAD from an outage.
        const outcome: Outcome = item.outcome ?? (item.available ? 'reachable' : 'unclassified');
        const available = ['unclassified', 'tls-unverified', 'certificate-changed'].includes(outcome) ? null : Boolean(item.available);
        const today = Date.parse(String(row.created)) >= Date.now() - 86400_000;
        if (available === null) {
          state.excluded++;
          if (today) state.dayExcluded++;
        } else {
          state.samples++;
          state.up += Number(available);
          if (today) { state.daySamples++; state.dayUp += Number(available); }
        }
        state.history.push({ at: String(row.created), available, outcome, status: item.status, latency: item.latency, error: item.error });
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
      services: db.prepare('SELECT id,title,url,category,open_mode FROM tiles ORDER BY category,title').all().map(({ open_mode, ...tile }) => {
        const state = histories.get(JSON.stringify([tile.id, tile.url]));
        const percentage = (up = 0, count = 0) => count ? Math.round(up / count * 10000) / 100 : null;
        return { ...tile, openMode: open_mode, remoteBrowser, certificateTrust: certificateTrust(Number(tile.id), String(tile.url)),
          last: state?.history.at(-1) ?? null, samples: state?.samples ?? 0, daySamples: state?.daySamples ?? 0,
          excluded: state?.excluded ?? 0, dayExcluded: state?.dayExcluded ?? 0,
          dayPercent: percentage(state?.dayUp, state?.daySamples), weekPercent: percentage(state?.up, state?.samples), history: state?.history ?? [] };
      }),
    };
  }

  return {
    summary,
    async handle(method: string, path: string, input: unknown, canWrite?: () => boolean) {
      if (path === '/api/admin/diagnostics' && method === 'GET') return summary();
      const certificateRoute = /^\/api\/admin\/diagnostics\/services\/([1-9]\d{0,14})\/(certificate|tls)$/.exec(path);
      if (certificateRoute && ((method === 'POST' && certificateRoute[2] === 'certificate') || (method === 'PUT' && certificateRoute[2] === 'tls'))) {
        const id = Number(certificateRoute[1]);
        const settings = certificateRoute[2] === 'tls' ? trustInput.parse(input)
          : z.object({ url: trustInput.shape.url }).strict().parse(input);
        const target = db.prepare('SELECT url FROM tiles WHERE id=?').get(id);
        if (!target) throw new DiagnosticError(404, 'Service not found.');
        const url = new URL(String(target.url));
        if (url.protocol !== 'https:' || url.username || url.password || url.href !== settings.url) {
          throw new DiagnosticError(409, 'The service URL changed. Reload its certificate settings.');
        }
        const inspecting = certificateRoute[2] === 'certificate';
        const fingerprint = 'fingerprint' in settings ? settings.fingerprint : null;
        let observed;
        if (inspecting || fingerprint) {
          try { observed = await readMonitorCertificate(url); }
          catch { throw new DiagnosticError(502, 'Could not read this service’s certificate. Check its address and availability.'); }
        }
        if (inspecting) return observed;
        if (!canWrite?.()) throw new DiagnosticError(403, 'Your administrator session changed. Sign in again.');
        if (!db.prepare('SELECT 1 FROM tiles WHERE id=? AND url=?').get(id, target.url)) {
          throw new DiagnosticError(409, 'The service URL changed. Reload its certificate settings.');
        }
        if (fingerprint && observed?.fingerprint !== fingerprint) throw new DiagnosticError(409, 'The certificate changed. Read it again before trusting it.');
        db.exec('BEGIN');
        try {
          db.prepare("DELETE FROM admin_records WHERE kind='monitor-certificate' AND label=?").run(String(id));
          if (fingerprint) db.prepare("INSERT INTO admin_records(kind,label,created,payload) VALUES ('monitor-certificate',?,?,?)")
            .run(String(id), new Date().toISOString(), JSON.stringify({ url: url.href, fingerprint }));
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return { trusted: Boolean(fingerprint) };
      }
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
