import { useEffect, useRef, useState } from 'react';
import type { DiagnosticApi } from './Diagnostics.js';
import { sshCredentialAddress, useCredentialVault } from './CredentialVault.js';
import { credentialLabel } from './VaultControls.js';

type Endpoint = { host: string; port: number; saved: boolean; hostname?: string; fingerprint?: string };
type Candidate = Endpoint & { name: string; selected: boolean };
type Interface = { name: string; range: string };
const path = 'admin/diagnostics/ssh/discover';

export function SshDiscovery({ api, select, onAdded }: {
  api: DiagnosticApi; select: (endpoint: Candidate) => void; onAdded: () => Promise<void>;
}) {
  const vault = useCredentialVault();
  const [credential, setCredential] = useState('');
  const [pendingAssignment, setPendingAssignment] = useState<{ address: string; username: string }[]>([]);
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
  useEffect(() => {
    let active = true;
    void api<Interface[]>(path).then(result => { if (active) setInterfaces(result); }).catch(() => { if (active) setInterfaces([]); });
    return () => { active = false; };
  }, [api]);
  const chosen = results.filter(endpoint => endpoint.selected && !endpoint.saved);
  const credentials = Object.entries(vault.entries ?? {}).filter(([, value]) => value.password);
  const selectedCredential = vault.entries?.[credential];
  async function assign(targets: { address: string; username: string }[]) {
    await vault.assign(credential, targets);
    setPendingAssignment([]);
  }
  function edit(index: number, changes: Partial<Candidate>) {
    setResults(current => current.map((endpoint, position) => position === index ? { ...endpoint, ...changes } : endpoint));
  }
  async function addSelected() {
    if (!chosen.length || saving || busy) return;
    if (credential && chosen.some(endpoint => !endpoint.fingerprint)) {
      setError('Scan again to read the SSH keys before assigning credentials.');
      return;
    }
    setSaving(true); setError('');
    try {
      if (credential && !vault.get(credential)?.password) {
        throw new Error('Unlock the vault and choose a saved credential before adding these machines.');
      }
      const report = await api<{ added: number; skipped: number; imported: { host: string; port: number; username: string }[] }>('admin/diagnostics/ssh/hosts/import', 'POST', {
        hosts: chosen.map(({ name, host, port }) => ({ name, host, port, username, group })),
      });
      const savedKeys = new Set(chosen.map(endpoint => endpoint.host + ':' + endpoint.port));
      setResults(current => current.map(endpoint => savedKeys.has(endpoint.host + ':' + endpoint.port)
        ? { ...endpoint, saved: true, selected: false } : endpoint));
      setNotice(`Added ${report.added} ${report.added === 1 ? 'machine' : 'machines'}. Skipped ${report.skipped} already saved entries.`);
      const targets = credential ? report.imported.map(machine => ({
        username: machine.username,
        address: sshCredentialAddress({ ...machine, fingerprint: chosen.find(endpoint =>
          endpoint.host === machine.host && endpoint.port === machine.port)!.fingerprint }),
      })) : [];
      setPendingAssignment(targets);
      await onAdded();
      if (credential && report.imported.length) {
        await assign(targets);
        setNotice(`Added ${report.added} ${report.added === 1 ? 'machine' : 'machines'} with vault credentials. Verify their host keys before connecting.`);
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not add machines.'); }
    finally { setSaving(false); }
  }

  return <section className="ssh-discovery" aria-label="SSH discovery">
    <form className="ssh-scan-form" onSubmit={async event => {
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
        setNotice(`${result.results.length} SSH ${result.results.length === 1 ? 'server' : 'servers'} found · ${result.checked} checks`);
      } catch (error) {
        if (controller.signal.aborted) setNotice('Scan canceled.');
        else { setNotice(''); setError(error instanceof Error ? error.message : 'SSH discovery failed.'); }
      } finally { scan.current = null; setBusy(false); }
    }}>
      <label>IP addresses or ranges<input name="range" list="ssh-discovery-ranges" placeholder="192.168.1.0/24" required maxLength={1024} aria-describedby="ssh-scan-help" /></label>
      <datalist id="ssh-discovery-ranges">{interfaces?.map(item => <option key={item.name + item.range} value={item.range}>{item.name}</option>)}</datalist>
      <label>Ports<input aria-label="Ports to check" name="ports" defaultValue="22" required maxLength={100} /></label>
      <div className="actions ssh-scan-actions"><button className={results.length ? undefined : 'primary'} disabled={busy || saving}>Scan for SSH</button>
        {busy && <button type="button" onClick={() => scan.current?.abort()}>Cancel scan</button>}</div>
    </form>
    <p className="muted ssh-discovery-help" id="ssh-scan-help">IP, CIDR, or start–end range. Comma-separated entries.</p>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {results.length > 0 && <form className="ssh-discovery-review" aria-label="Review discovered SSH machines" onSubmit={event => {
      event.preventDefault();
      void addSelected();
    }}>
      <div className="ssh-discovery-selection">
        <strong>{chosen.length} selected</strong>
        <div className="actions">
          <button type="button" disabled={saving} aria-label="Select discovered machines" onClick={() => setResults(current => current.map(endpoint => ({ ...endpoint, selected: !endpoint.saved })))}>Select all</button>
          <button type="button" disabled={saving || !chosen.length} aria-label="Clear discovered selection" onClick={() => setResults(current => current.map(endpoint => ({ ...endpoint, selected: false })))}>Clear</button>
        </div>
      </div>
      <ul className="ssh-discovery-results" aria-label="Discovered SSH machines">{results.map((endpoint, index) => <li key={endpoint.host + ':' + endpoint.port} className="ssh-discovery-row">
        <input type="checkbox" aria-label={`Select discovered ${endpoint.host}:${endpoint.port}`}
          checked={endpoint.selected} disabled={saving || endpoint.saved} onChange={event => edit(index, { selected: event.target.checked })} />
        <div className="ssh-discovery-machine">
          <input aria-label={`Name for ${endpoint.host}:${endpoint.port}`} value={endpoint.name}
            required={endpoint.selected} maxLength={80} disabled={saving || endpoint.saved}
            onChange={event => edit(index, { name: event.target.value })} />
          <small className="muted">{endpoint.host}:{endpoint.port}{endpoint.hostname && endpoint.hostname !== endpoint.name ? ' · ' + endpoint.hostname : ''}</small>
        </div>
        {endpoint.saved ? <small className="muted">Added</small> :
          <button type="button" disabled={saving} title="Set up this machine individually" aria-label={`Use ${endpoint.host}:${endpoint.port}`} onClick={() => select(endpoint)}>Details</button>}
      </li>)}</ul>
      <fieldset className="ssh-import-settings" disabled={saving}>
        <legend>For selected machines</legend>
        <div className="ssh-import-fields">
        <label>Saved credential<select aria-label="Vault credential for selected machines" value={credential} disabled={saving || !!pendingAssignment.length}
          onChange={event => {
            setCredential(event.target.value);
            const saved = vault.entries?.[event.target.value];
            if (saved) setUsername(saved.username);
          }}>
          <option value="">Set passwords later</option>
          {credentials.map(([address, value]) => <option key={address} value={address}>{value.username} · {credentialLabel(address)}</option>)}
          {credential && !selectedCredential && <option value={credential}>Unlock vault to use the selected credential</option>}
        </select></label>
        <label>SSH username<input aria-label="SSH username for selected machines" value={username} onChange={event => setUsername(event.target.value)}
          autoComplete="off" maxLength={64} required disabled={saving} /></label>
        <label>Group<input aria-label="Group for selected machines" value={group} onChange={event => setGroup(event.target.value)} maxLength={60} placeholder="Ungrouped" disabled={saving} /></label>
        </div>
        {!vault.entries && <p className="muted ssh-discovery-help">Unlock Vault in the header to use a saved credential.</p>}
      </fieldset>
      <div className="ssh-import-footer">
        <small className="muted">Verify host keys before connecting.</small>
        <button className="primary" disabled={saving || busy || !chosen.length || !!pendingAssignment.length || (!!credential && !selectedCredential)}>{saving ? 'Adding machines…' : `Add selected machines (${chosen.length})`}</button>
      </div>
    </form>}
    {pendingAssignment.length > 0 && <div className="credential-panel">
      <p>The machines are saved. Their vault credentials still need to be assigned.</p>
      <button type="button" disabled={saving || !selectedCredential} onClick={async () => {
        setSaving(true); setError('');
        try { await assign(pendingAssignment); setNotice('Vault credentials assigned. Verify each host key before connecting.'); }
        catch (error) { setError(error instanceof Error ? error.message : 'Could not assign vault credentials.'); }
        finally { setSaving(false); }
      }}>Retry credential assignment</button>
      <button type="button" disabled={saving} onClick={() => { setPendingAssignment([]); setCredential(''); setError(''); }}>Set credentials later</button>
    </div>}
  </section>;
}
