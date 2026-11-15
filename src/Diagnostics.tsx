import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { OpenMode } from './preferences.js';

export type DiagnosticApi = <T>(path: string, method?: string, body?: object, signal?: AbortSignal) => Promise<T>;
export function formatBytes(value: number) {
  if (!Number.isFinite(value)) return 'Unavailable';
  if (value < 1024) return Math.round(value) + ' B';
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return (value / 1024 ** unit).toFixed(1) + ' ' + ['B', 'KiB', 'MiB', 'GiB'][unit];
}
export function formatUptime(seconds: number) {
  return Math.floor(seconds / 86400) + 'd ' + Math.floor(seconds / 3600 % 24) + 'h ' + Math.floor(seconds / 60 % 60) + 'm';
}
const outcomeLabels = {
  reachable: 'Reachable', 'http-error': 'HTTP error', 'tls-unverified': 'Certificate unverified',
  timeout: 'Timed out', 'connection-failed': 'Connection failed', unclassified: 'Unconfirmed',
};
type Sample = { at: string; available: boolean | null; outcome: keyof typeof outcomeLabels; status: number | null; latency: number; error?: string };
export type DiagnosticService = { id: number; title: string; url: string; category: string; openMode?: OpenMode | 'default'; remoteBrowser?: boolean };
type Summary = {
  enabled: boolean; running: boolean; intervalSeconds: number;
  host: { hostname: string; os: string; kernel: string; architecture: string; cpu: string; logicalCpus: number;
    totalMemory: number; freeMemory: number; machineUptime: number; serviceUptime: number; serviceMemory: number;
    load: number[]; cpuTimes: { user: number; nice: number; sys: number; idle: number; irq: number }[];
    interfaces: { name: string; address: string; family: string; internal: boolean }[] };
  services: (DiagnosticService & { last: Sample | null; samples: number; daySamples: number;
    dayPercent: number | null; weekPercent: number | null; dayExcluded: number; excluded: number; history: Sample[] })[];
};

export function Diagnostics({ api, serviceLink }: { api: DiagnosticApi; serviceLink: (service: DiagnosticService, label: string) => ReactNode }) {
  const [tab, setTab] = useState('services');
  const [summary, setSummary] = useState<Summary>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [speed, setSpeed] = useState<{ latency: number; down: number; up: number }>();
  const [cpu, setCpu] = useState<number | null>(null);
  const previousCpu = useRef<{ total: number; idle: number }>(undefined);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await api<Summary>('admin/diagnostics');
        if (!active) return;
        const total = data.host.cpuTimes.reduce((sum, times) => sum + Object.values(times).reduce((a, b) => a + b, 0), 0);
        const idle = data.host.cpuTimes.reduce((sum, times) => sum + times.idle, 0);
        const before = previousCpu.current;
        if (before && total > before.total) setCpu(100 * (1 - (idle - before.idle) / (total - before.total)));
        previousCpu.current = { total, idle };
        setSummary(data);
      } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Unable to load diagnostics.'); }
      finally { if (active) timer = setTimeout(load, 5000); }
    }
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [api]);

  async function run(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : 'Diagnostic failed.'); }
    finally { setBusy(false); }
  }
  const host = summary?.host;
  const services = summary?.services.filter(service => [service.title, service.url, service.category].some(value => value.toLowerCase().includes(filter.toLowerCase()))) ?? [];
  return <div className="diagnostics">
    <nav className="admin-nav" aria-label="Diagnostic sections">
      {[['services', 'Service uptime'], ['host', 'Dashboard host'], ['network', 'Network test']].map(([id, label]) =>
        <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {error && <p role="alert" className="error">{error}</p>}
    {tab === 'services' && <section className="tile">
      <h2>Service uptime</h2>
      <p className="muted">Checks run from the StackJetty server. Sign-in responses count as reachable. Checks with unverified certificates are shown separately and excluded from availability.</p>
      <div className="admin-controls">
        <button disabled={busy || !summary || summary.running} onClick={() => void run(async () => {
          await api('admin/diagnostics/monitor', 'PUT', { enabled: !summary!.enabled });
          setSummary(await api('admin/diagnostics'));
        })}>{summary?.enabled ? 'Pause monitoring' : 'Enable monitoring'}</button>
        <button disabled={busy || summary?.running} onClick={() => void run(async () =>
          setSummary(await api('admin/diagnostics/check', 'POST')))}>{busy || summary?.running ? 'Checking…' : 'Check services now'}</button>
        <label>Find service<input type="search" value={filter} onChange={event => setFilter(event.target.value)} /></label>
      </div>
      <p role="status" className="muted">{!summary ? 'Loading service history…' : summary.enabled
        ? 'Monitoring every 60 seconds while StackJetty is running.' : 'Monitoring is paused. Run a check or enable automatic monitoring.'}</p>
      {summary && services.length === 0 && <p>No matching services.</p>}
      <div className="diagnostic-services">{services.map(service => <article key={service.id}>
        <div className="diagnostic-service-head">{serviceLink(service, service.title)}<span className={service.last?.available ? 'state-up' : 'muted'}>
          {service.last ? outcomeLabels[service.last.outcome] : 'No checks yet'}</span></div>
        <div className="muted diagnostic-url">{serviceLink(service, service.url)}</div>
        <dl className="metric-grid">
          <div><dt>24-hour availability</dt><dd>{service.dayPercent === null ? '—' : service.dayPercent + '%'} <small>({service.daySamples} counted{service.dayExcluded ? ', ' + service.dayExcluded + ' unconfirmed' : ''})</small></dd></div>
          <div><dt>7-day availability</dt><dd>{service.weekPercent === null ? '—' : service.weekPercent + '%'} <small>({service.samples} counted{service.excluded ? ', ' + service.excluded + ' unconfirmed' : ''})</small></dd></div>
          <div><dt>Response time</dt><dd>{service.last ? service.last.latency + ' ms' : '—'}</dd></div>
          <div><dt>Last check</dt><dd>{service.last ? new Date(service.last.at).toLocaleString() : '—'}</dd></div>
        </dl>
        <div className="uptime-history" aria-label={service.title + ' recent checks'}>{service.history.map((sample, index) =>
          <span key={index} className={sample.available === null ? 'check-unknown' : sample.available ? 'check-up' : 'check-down'}
            title={new Date(sample.at).toLocaleString() + ' · ' + outcomeLabels[sample.outcome] + (sample.status ? ' · HTTP ' + sample.status : '') + ' · ' + sample.latency + ' ms'} />)}</div>
        {service.last?.error && <small className="muted">{service.last.error}</small>}
      </article>)}</div>
    </section>}
    {tab === 'host' && <section className="tile"><h2>Dashboard host</h2>{host ? <>
      <div className="metric-grid diagnostic-metrics">
        <div><span>CPU</span><strong>{cpu === null ? 'Sampling…' : cpu.toFixed(1) + '%'}</strong><progress aria-label="Host CPU usage" max={100} value={cpu ?? undefined} /></div>
        <div><span>Memory used</span><strong>{formatBytes(host.totalMemory - host.freeMemory)}</strong><progress aria-label="Host memory usage" max={host.totalMemory} value={host.totalMemory - host.freeMemory} /></div>
        <div><span>Host uptime</span><strong>{formatUptime(host.machineUptime)}</strong></div>
        <div><span>StackJetty uptime</span><strong>{formatUptime(host.serviceUptime)}</strong></div>
      </div>
      <dl className="metric-grid"><div><dt>Machine</dt><dd>{host.hostname}</dd></div><div><dt>OS</dt><dd>{host.os} · {host.kernel} · {host.architecture}</dd></div>
        <div><dt>Processor</dt><dd>{host.cpu || 'Model unavailable'} · {host.logicalCpus} cores</dd></div><div><dt>Load averages</dt><dd>{host.load.map(value => value.toFixed(2)).join(' · ')}</dd></div>
        <div><dt>Total memory</dt><dd>{formatBytes(host.totalMemory)}</dd></div><div><dt>StackJetty memory</dt><dd>{formatBytes(host.serviceMemory)}</dd></div></dl>
      <h3>Network interfaces</h3><ul className="user-list">{host.interfaces.map((item, index) => <li key={index}><strong>{item.name}</strong><span>{item.address} · {item.family}{item.internal ? ' · loopback' : ''}</span></li>)}</ul>
    </> : <p>Loading machine information…</p>}</section>}
    {tab === 'network' && <section className="tile"><h2>Browser-to-dashboard network test</h2>
      <p className="muted">Measure this browser’s connection to StackJetty using a 4 MiB download and upload. Results include proxy and tunnel overhead when present.</p>
      <button disabled={busy} onClick={() => void run(async () => {
        const started = performance.now();
        await api('session');
        const latency = performance.now() - started;
        const downStart = performance.now();
        const response = await fetch('/api/admin/diagnostics/speed', { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error('The download test failed.');
        const bytes = (await response.arrayBuffer()).byteLength;
        const down = bytes * 8 / ((performance.now() - downStart) / 1000) / 1e6;
        const payload = 'x'.repeat(4 * 1024 * 1024);
        const upStart = performance.now();
        await api('admin/diagnostics/speed', 'POST', { payload });
        const up = payload.length * 8 / ((performance.now() - upStart) / 1000) / 1e6;
        setSpeed({ latency, down, up });
      })}>{busy ? 'Testing connection…' : 'Run network test'}</button>
      {speed && <dl className="metric-grid diagnostic-metrics" role="status"><div><dt>Round trip</dt><dd>{speed.latency.toFixed(1)} ms</dd></div>
        <div><dt>Download</dt><dd>{speed.down.toFixed(1)} Mbps</dd></div><div><dt>Upload</dt><dd>{speed.up.toFixed(1)} Mbps</dd></div></dl>}
    </section>}
  </div>;
}
