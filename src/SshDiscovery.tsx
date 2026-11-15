import { useEffect, useRef, useState } from 'react';
import type { DiagnosticApi } from './Diagnostics.js';

type Endpoint = { host: string; port: number; saved: boolean; hostname?: string };
type Candidate = Endpoint & { name: string; selected: boolean };
type Interface = { name: string; range: string };
const path = 'admin/diagnostics/ssh/discover';

export function SshDiscovery({ api, select, onAdded }: {
  api: DiagnosticApi; select: (endpoint: Candidate) => void; onAdded: () => Promise<void>;
}) {
  const [interfaces, setInterfaces] = useState<Interface[]>();
  const [results, setResults] = useState<Candidate[]>([]);
  const [username, setUsername] = useState('');
  const [group, setGroup] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const scan = useRef<AbortController>(null);
  useEffect(() => () => scan.current?.abort(), []);
  const chosen = results.filter(endpoint => endpoint.selected && !endpoint.saved);
  function edit(index: number, changes: Partial<Candidate>) {
    setResults(current => current.map((endpoint, position) => position === index ? { ...endpoint, ...changes } : endpoint));
  }

  return <details className="ssh-discovery" onToggle={event => {
    if (event.currentTarget.open && !interfaces) {
      void api<Interface[]>(path).then(setInterfaces).catch(() => setInterfaces([]));
    }
  }}>
    <summary>Discover SSH machines</summary>
    <form className="machine-form" onSubmit={async event => {
      event.preventDefault();
      if (scan.current) return;
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const controller = new AbortController();
      scan.current = controller;
      setBusy(true); setResults([]); setError(''); setNotice('Looking for SSH servers…');
      try {
        const result = await api<{ results: Endpoint[]; checked: number }>(path, 'POST', data, controller.signal);
        setResults(result.results.map(endpoint => ({ ...endpoint,
          name: (endpoint.hostname || 'SSH ' + endpoint.host).slice(0, 80), selected: !endpoint.saved })));
        setNotice(`Found ${result.results.length} SSH ${result.results.length === 1 ? 'server' : 'servers'} after checking ${result.checked} address and port combinations.`);
      } catch (error) {
        if (controller.signal.aborted) setNotice('Scan canceled.');
        else { setNotice(''); setError(error instanceof Error ? error.message : 'SSH discovery failed.'); }
      } finally { scan.current = null; setBusy(false); }
    }}>
      <label>IP addresses or ranges<input name="range" list="ssh-discovery-ranges" placeholder="192.168.1.0/24" required maxLength={1024} /></label>
      <datalist id="ssh-discovery-ranges">{interfaces?.map(item => <option key={item.name + item.range} value={item.range}>{item.name}</option>)}</datalist>
      <label>Ports to check<input name="ports" defaultValue="22" required maxLength={100} /></label>
      <p className="muted">Use private IPv4 addresses, CIDR ranges, or start–end ranges. Separate entries with commas.</p>
      <div className="actions"><button className="primary" disabled={busy || saving}>Scan for SSH</button>
        {busy && <button type="button" onClick={() => scan.current?.abort()}>Cancel scan</button>}</div>
    </form>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {results.length > 0 && <form className="ssh-discovery-review" aria-label="Review discovered SSH machines" onSubmit={async event => {
      event.preventDefault();
      if (!chosen.length || saving || busy) return;
      setSaving(true); setError('');
      try {
        const report = await api<{ added: number; skipped: number }>('admin/diagnostics/ssh/hosts/import', 'POST', {
          hosts: chosen.map(({ name, host, port }) => ({ name, host, port, username, group })),
        });
        const savedKeys = new Set(chosen.map(endpoint => endpoint.host + ':' + endpoint.port));
        setResults(current => current.map(endpoint => savedKeys.has(endpoint.host + ':' + endpoint.port)
          ? { ...endpoint, saved: true, selected: false } : endpoint));
        setNotice(`Added ${report.added} ${report.added === 1 ? 'machine' : 'machines'}. Skipped ${report.skipped} already saved entries.`);
        await onAdded();
      } catch (error) { setError(error instanceof Error ? error.message : 'Could not add machines.'); }
      finally { setSaving(false); }
    }}>
      <div className="machine-form">
        <label>SSH username for selected machines<input value={username} onChange={event => setUsername(event.target.value)}
          autoComplete="off" maxLength={64} required disabled={saving} /></label>
        <label>Group for selected machines<input value={group} onChange={event => setGroup(event.target.value)} maxLength={60} disabled={saving} /></label>
      </div>
      <div className="actions">
        <button type="button" disabled={saving} onClick={() => setResults(current => current.map(endpoint => ({ ...endpoint, selected: !endpoint.saved })))}>Select discovered machines</button>
        <button type="button" disabled={saving || !chosen.length} onClick={() => setResults(current => current.map(endpoint => ({ ...endpoint, selected: false })))}>Clear discovered selection</button>
      </div>
      <ul className="user-list">{results.map((endpoint, index) => <li key={endpoint.host + ':' + endpoint.port}>
        <div className="ssh-discovery-result">
          <input type="checkbox" aria-label={`Select discovered ${endpoint.host}:${endpoint.port}`}
            checked={endpoint.selected} disabled={saving || endpoint.saved} onChange={event => edit(index, { selected: event.target.checked })} />
          <div><strong>{endpoint.host}:{endpoint.port}</strong>
            {endpoint.hostname && <small className="muted ssh-machine-status">Detected hostname · {endpoint.hostname}</small>}
            <label>Machine name<input aria-label={`Name for ${endpoint.host}:${endpoint.port}`} value={endpoint.name}
              required={endpoint.selected} maxLength={80} disabled={saving || endpoint.saved}
              onChange={event => edit(index, { name: event.target.value })} /></label>
          </div>
        </div>
        {endpoint.saved ? <small className="muted">Already saved</small> :
          <button type="button" disabled={saving} aria-label={`Use ${endpoint.host}:${endpoint.port}`} onClick={() => select(endpoint)}>Use address</button>}
      </li>)}</ul>
      <button className="primary" disabled={saving || busy || !chosen.length}>{saving ? 'Adding machines…' : `Add selected machines (${chosen.length})`}</button>
      <p className="muted">Review each name before adding. Hostnames come from network DNS when available. Verify each machine’s host key before connecting.</p>
    </form>}
  </details>;
}
