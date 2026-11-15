import { useEffect, useRef, useState } from 'react';
import type { DiagnosticApi } from './Diagnostics.js';

type Endpoint = { host: string; port: number; saved: boolean };
type Interface = { name: string; range: string };
const path = 'admin/diagnostics/ssh/discover';

export function SshDiscovery({ api, select }: { api: DiagnosticApi; select: (endpoint: Endpoint) => void }) {
  const [interfaces, setInterfaces] = useState<Interface[]>();
  const [report, setReport] = useState<{ results: Endpoint[]; checked: number }>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const scan = useRef<AbortController>(null);
  useEffect(() => () => scan.current?.abort(), []);

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
      setBusy(true); setReport(undefined); setError(''); setNotice('Looking for SSH servers…');
      try {
        const result = await api<{ results: Endpoint[]; checked: number }>(path, 'POST', data, controller.signal);
        setReport(result);
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
      <div className="actions"><button className="primary" disabled={busy}>Scan for SSH</button>
        {busy && <button type="button" onClick={() => scan.current?.abort()}>Cancel scan</button>}</div>
    </form>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {!!report?.results.length && <ul className="user-list">{report.results.map(endpoint =>
      <li key={endpoint.host + ':' + endpoint.port}>
        <strong>{endpoint.host}:{endpoint.port}</strong>
        {endpoint.saved ? <small className="muted">Already saved</small> :
          <button aria-label={`Use ${endpoint.host}:${endpoint.port}`} onClick={() => select(endpoint)}>Use address</button>}
      </li>)}</ul>}
  </details>;
}
