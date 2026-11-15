import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { formatBytes, formatUptime, type DiagnosticApi } from './Diagnostics.js';
import { sshCredentialAddress, useCredentialVault } from './CredentialVault.js';
import { VaultEditor } from './VaultControls.js';
import { RemoteFiles } from './RemoteFiles.js';
import { SshDiscovery } from './SshDiscovery.js';

type Host = { id: number; name: string; host: string; port: number; username: string; fingerprint?: string; group?: string };
type BatchChanges = Partial<Pick<Host, 'group' | 'username' | 'port'>>;
type Catalog = { enabled: boolean; secureTransport: boolean; discoveryEnabled?: boolean; hosts: Host[] };
const sshPath = 'admin/diagnostics/ssh';
const hostPath = sshPath + '/hosts';
const destination = (host: Host) => sshCredentialAddress({ ...host, fingerprint: host.fingerprint || '' }).slice(4);
type Connection = { id: string; name: string; hostId: number; number: number };
type Stats = {
  system: string; uptime: number; cores: number; cpuPercent: number | null; load: number[];
  memory: { total: number; available: number; swapTotal: number; swapFree: number };
  network: { rx: number; tx: number; rxPerSecond: number | null; txPerSecond: number | null };
  disks: string; processes: string;
};

function RemoteTerminal({ api, connection, visible }: { api: DiagnosticApi; connection: Connection; visible: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const followOutput = useRef<(signal: AbortSignal) => Promise<void>>(undefined);
  useEffect(() => {
    if (!container.current) return;
    const terminal = new Terminal({ cursorBlink: true, disableStdin: true, fontSize: 14, scrollback: 2000, allowProposedApi: false, screenReaderMode: true,
      theme: { background: '#10171c', foreground: '#edf3f4' } });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current);
    fit.fit();
    const root = 'admin/diagnostics/ssh/' + connection.id;
    let active = true;
    let inputTimer: ReturnType<typeof setTimeout> | undefined;
    let cursor = 0;
    let sequence = 0;
    let pending = '';
    let sending = false;
    let failed = false;
    async function flushInput() {
      inputTimer = undefined;
      if (sending || !active || failed) return;
      sending = true;
      try {
        while (pending && active) {
          // Don't split a surrogate pair between SSH writes.
          let end = Math.min(pending.length, 8192);
          if (end < pending.length && /[\ud800-\udbff]/.test(pending[end - 1])) end--;
          const data = pending.slice(0, end);
          pending = pending.slice(end);
          await api(root + '/input', 'POST', { sequence: ++sequence, data });
        }
      } catch {
        failed = true;
        if (active) {
          terminal.options.disableStdin = true;
          setError('Shell input stopped. Reconnect to continue.');
        }
      } finally {
        sending = false;
      }
    }
    followOutput.current = async signal => {
      let retry = true;
      while (active && !signal.aborted) {
        try {
          const response = await api<{ output: string; cursor: number; truncated: boolean; closed: boolean }>(root + '/output', 'POST', { cursor, wait: true }, signal);
          if (!active || signal.aborted) return;
          retry = true;
          if (response.truncated) terminal.writeln('\r\n[Earlier output was discarded]\r\n');
          if (response.output) terminal.write(response.output);
          cursor = response.cursor;
          if (response.closed) { terminal.options.disableStdin = true; setError('The remote shell closed.'); return; }
        } catch (error) {
          if (!active || signal.aborted) return;
          const message = error instanceof Error ? error.message : 'Shell connection failed.';
          if (retry && message === 'A shell output request is already waiting.') {
            retry = false;
            await new Promise(resolve => setTimeout(resolve, 150));
            continue;
          }
          terminal.options.disableStdin = true;
          setError(message);
          return;
        }
      }
    };
    const input = terminal.onData(data => {
      if (failed) return;
      if (pending.length + data.length > 262144) {
        setError('The paste is too large. Send smaller chunks.');
        return;
      }
      pending += data;
      if (!sending && inputTimer === undefined) inputTimer = setTimeout(() => void flushInput(), 8);
    });
    const resize = terminal.onResize(size => {
      if (active) void api(root + '/resize', 'POST', { rows: Math.max(2, Math.min(200, size.rows)), columns: Math.max(10, Math.min(300, size.cols)) }).catch(() => {});
    });
    const observer = new ResizeObserver(() => { if (active && container.current?.clientWidth) fit.fit(); });
    observer.observe(container.current);
    void api(root + '/shell', 'POST').then(() => { if (active) {
      terminal.options.disableStdin = false; setReady(true);
      if (container.current?.clientWidth) { fit.fit(); terminal.focus(); }
    } })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; followOutput.current = undefined; clearTimeout(inputTimer); observer.disconnect(); input.dispose(); resize.dispose(); terminal.dispose(); };
  }, [api, connection.id]);
  useEffect(() => {
    if (!ready || !visible) return;
    const controller = new AbortController();
    void followOutput.current?.(controller.signal);
    return () => controller.abort();
  }, [ready, visible]);
  return <><p role="status">{ready ? 'Shell ready' : 'Opening shell…'}</p><div inert={!visible} className="ssh-terminal" ref={container} aria-label={connection.name + ' SSH terminal'} />
    {error && <p role="alert" className="error">{error}</p>}</>;
}

function SavedSshPassword({ host, connect }: {
  host: Host; connect: (password: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return <details className="credential-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Saved SSH password</summary>
    {open && <VaultEditor address={sshCredentialAddress(host)} machine={{ id: host.id, username: host.username }}
      onUse={credential => connect(credential.password)} />}
  </details>;
}

function MachineFields({ host }: { host?: Host }) {
  return <>
    <label>Machine name<input name="name" defaultValue={host?.name} required maxLength={80} /></label>
    <label>Machine group<input name="group" defaultValue={host?.group} maxLength={60} placeholder="Ungrouped" /></label>
    <label>SSH host<input name="host" defaultValue={host?.host} autoComplete="off" required maxLength={253} placeholder="server.example.com" /></label>
    <label>SSH port<input name="port" type="number" defaultValue={host?.port ?? 22} min={1} max={65535} required /></label>
    <label>SSH username<input name="username" defaultValue={host?.username} autoComplete="off" required maxLength={64} /></label>
    <label>Trusted host fingerprint (optional)<input name="fingerprint" defaultValue={host?.fingerprint} autoComplete="off" placeholder="SHA256:…" /></label>
  </>;
}

function BatchMachineEdit({ count, busy, onSave, onClose }: {
  count: number; busy: boolean; onSave: (changes: BatchChanges) => void; onClose: () => void;
}) {
  const [field, setField] = useState<keyof BatchChanges>('group');
  return <form className="machine-form" onSubmit={event => {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('value'));
    onSave(field === 'port' ? { port: Number(value) } : { [field]: value });
  }}>
    <h3>Edit {count} selected {count === 1 ? 'machine' : 'machines'}</h3>
    <label>Field to change<select value={field} onChange={event => setField(event.target.value as keyof BatchChanges)}>
      <option value="group">Group</option><option value="username">SSH username</option><option value="port">SSH port</option>
    </select></label>
    {field === 'group' && <label>New group<input key={field} name="value" maxLength={60} placeholder="Ungrouped" /></label>}
    {field === 'username' && <label>New SSH username<input key={field} name="value" autoComplete="off" maxLength={64} required /></label>}
    {field === 'port' && <label>New SSH port<input key={field} name="value" type="number" min={1} max={65535} required /></label>}
    <p className="muted">{field === 'group' ? 'Leave blank to move machines to Ungrouped.'
      : field === 'port' ? 'Changing the port closes open sessions and requires reviewing the host key again.'
        : 'Changing the username closes open sessions. Saved passwords are specific to the SSH username.'}</p>
    <div className="actions"><button disabled={busy} className="primary">Apply to selected</button>
      <button disabled={busy} type="button" onClick={onClose}>Cancel batch edit</button></div>
  </form>;
}

export function MachineConsole({ api, visible }: { api: DiagnosticApi; visible: boolean }) {
  const vault = useCredentialVault();
  const [catalog, setCatalog] = useState<Catalog>();
  const [hostId, setHostId] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeId, setActiveId] = useState('');
  const sessionIds = useRef(new Set<string>());
  const mounted = useRef(false);
  const nextNumber = useRef(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Host>();
  const [selected, setSelected] = useState<number[]>([]);
  const [batchEdit, setBatchEdit] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<number>();
  const [authentication, setAuthentication] = useState('password');
  const [observedKey, setObservedKey] = useState<{ hostId: number; fingerprint: string; expected: string }>();
  const addMachineDetails = useRef<HTMLDetailsElement>(null);
  const addForm = useRef<HTMLFormElement>(null);
  const connectionHeading = useRef<HTMLHeadingElement>(null);
  async function load() {
    const next = await api<Catalog>(sshPath);
    setCatalog(next);
    setSelected(current => current.filter(id => next.hosts.some(host => host.id === id)));
    setConnections(current => current.map(session => ({ ...session, name: next.hosts.find(host => host.id === session.hostId)?.name ?? session.name })));
    return next;
  }
  useEffect(() => { void load().catch(error => setError(error.message)); }, [api]);
  function release(id: string) {
    void fetch('/api/admin/diagnostics/ssh/' + id, { method: 'DELETE', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  }
  useEffect(() => {
    mounted.current = true;
    const disconnectAll = () => {
      mounted.current = false;
      for (const id of sessionIds.current) release(id);
      sessionIds.current.clear();
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) { mounted.current = true; setConnections([]); setActiveId(''); }
    };
    window.addEventListener('pagehide', disconnectAll);
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pagehide', disconnectAll);
      window.removeEventListener('pageshow', restore);
      disconnectAll();
    };
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : 'SSH operation failed.'); }
    finally { setBusy(false); }
  }
  async function connect(host: Host, credentials: object) {
    const result = await api<{ id: string; name: string }>(sshPath + '/connect', 'POST',
      { ...credentials, hostId: host.id, expected: destination(host) });
    if (!mounted.current) { release(result.id); return; }
    const session = { ...result, hostId: host.id, number: ++nextNumber.current };
    sessionIds.current.add(session.id);
    setConnections(current => [...current, session]);
    setActiveId(session.id);
    setHostId('');
  }
  function forget(ids: string[]) {
    for (const id of ids) sessionIds.current.delete(id);
    setConnections(current => current.filter(session => !ids.includes(session.id)));
  }
  async function disconnect(ids: string[]) {
    const result = await Promise.allSettled(ids.map(id => api(sshPath + '/' + id, 'DELETE')));
    forget(ids.filter((_, index) => result[index].status === 'fulfilled'));
    if (result.some(item => item.status === 'rejected')) {
      const { ids: open } = await api<{ ids: string[] }>(sshPath + '/sessions');
      forget(ids.filter(id => !open.includes(id)));
      if (ids.some(id => open.includes(id))) throw new Error('Some SSH sessions could not be disconnected. Try again.');
    }
    setNotice(ids.length === 1 ? 'SSH session disconnected.' : `${ids.length} SSH sessions disconnected.`);
  }
  async function saveHosts(path: string, data: object) {
    const { reconnect } = await api<{ reconnect: number[] }>(path, 'PATCH', data);
    forget(connections.filter(session => reconnect.includes(session.hostId)).map(session => session.id));
    setObservedKey(undefined);
    await load();
  }
  const hasConnections = connections.length > 0;
  useEffect(() => {
    if (!hasConnections || !visible) return;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      const known = [...sessionIds.current];
      try {
        const { ids } = await api<{ ids: string[] }>(sshPath + '/sessions', 'GET', undefined, controller.signal);
        if (!controller.signal.aborted) forget(known.filter(id => !ids.includes(id)));
      } catch { /* The next refresh can reconcile connections. */ }
    }, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [api, hasConnections, visible]);
  const selectedId = connections.some(session => session.id === activeId) ? activeId : connections.at(-1)?.id;
  const selectedHost = catalog?.hosts.find(host => String(host.id) === hostId);
  const secure = window.isSecureContext && catalog?.secureTransport;
  const shown = (catalog?.hosts ?? []).filter(host =>
    [host.name, host.host, host.username, host.group, String(host.port)].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())));
  const groups = Map.groupBy(shown, host => host.group || '');
  const selectedSessions = connections.filter(session => selected.includes(session.hostId));
  async function connectSelected() {
    const current = await load();
    const skipped: string[] = [];
    let opened = 0;
    for (const id of selected) {
      if (!mounted.current) return;
      const host = current.hosts.find(entry => entry.id === id);
      if (!host) { skipped.push('A selected machine was removed.'); continue; }
      if (connections.some(session => session.hostId === host.id)) continue;
      if (!host.fingerprint) { skipped.push(host.name + ': review the host key first.'); continue; }
      try {
        const credential = vault.get(sshCredentialAddress(host));
        if (!credential?.password || credential.username !== host.username) {
          skipped.push(host.name + ': unlock the vault and save a matching password, or connect individually.');
          continue;
        }
        await connect(host, { authentication: 'password', password: credential.password });
        opened++;
      } catch (error) { skipped.push(host.name + ': ' + (error instanceof Error ? error.message : 'Could not connect.')); }
    }
    setNotice(`Opened ${opened} SSH ${opened === 1 ? 'session' : 'sessions'}. Already connected machines were left open.`);
    if (skipped.length) setError(skipped.join('\n'));
  }
  useEffect(() => {
    if (visible && selectedHost && secure) connectionHeading.current?.focus();
  }, [selectedHost?.id, selectedHost?.fingerprint, secure, visible]);
  return <section className="tile machine-console">
    <h2>SSH machines</h2>
    <p className="muted">Sign in with the remote machine’s username and password, or a private key. Saved passwords are encrypted in this browser. Sessions stay open while you switch views. Signing out closes all sessions.</p>
    {error && <p role="alert" className="error ssh-feedback">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!catalog ? <p>Loading saved machines…</p> : !catalog.enabled ? <p>Enable NEXUS_SSH=on in the server environment to connect machines.</p> : <>
      {!secure && <p className="error">Open StackJetty over HTTPS or through an SSH-encrypted localhost connection to enter SSH credentials.</p>}
        <details ref={addMachineDetails}><summary>Add SSH machine</summary>
          {catalog.discoveryEnabled && secure && <SshDiscovery api={api} onAdded={async () => { await load(); }} select={endpoint => {
            const fields = addForm.current?.elements;
            if (!fields) return;
            for (const [name, value] of Object.entries({ name: endpoint.name, host: endpoint.host, port: String(endpoint.port), fingerprint: '' })) {
              const field = fields.namedItem(name);
              if (field instanceof HTMLInputElement) field.value = value;
            }
            const username = fields.namedItem('username');
            if (username instanceof HTMLInputElement) username.focus();
          }} />}
          <p className="muted">Leave the fingerprint blank to review the server’s key on your first connection.</p>
          <form ref={addForm} className="machine-form" onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = Object.fromEntries(new FormData(form));
            void run(async () => {
              const saved = await api<{ id: number }>(hostPath, 'POST', { ...data, port: Number(data.port) });
              form.reset();
              await load();
              if (secure) {
                if (addMachineDetails.current) addMachineDetails.current.open = false;
                setAuthentication('password');
                setHostId(String(saved.id));
              }
            });
          }}>
            <MachineFields />
            <p className="muted">{secure ? 'You’ll continue to the connection setup.' : 'Save the machine here, then use HTTPS or the SSH tunnel to connect.'}</p>
            <button disabled={busy}>{secure ? 'Save machine and continue' : 'Save machine'}</button>
          </form>
        </details>
        <div className="ssh-machine-toolbar">
          <label>Search machines<input type="search" value={query} disabled={!catalog.hosts.length} onChange={event => setQuery(event.target.value)} placeholder="Name, address, or group" /></label>
          <div className="ssh-batch-actions" role="group" aria-label="Bulk machine actions">
            <p role="status">{selected.length} selected</p>
            <div className="actions">
              <button disabled={busy || !shown.length} onClick={() => setSelected([...new Set([...selected, ...shown.map(host => host.id)])])}>Select visible</button>
              <button disabled={busy || !selected.length} onClick={() => { setSelected([]); setBatchEdit(false); }}>Clear selection</button>
              <button disabled={busy || !selected.length} aria-expanded={batchEdit} onClick={() => { setEditing(undefined); setBatchEdit(!batchEdit); }}>Batch edit</button>
              <button disabled={busy || !selected.length || !secure} onClick={() => void run(connectSelected)}>Connect selected</button>
              <button disabled={busy || !selectedSessions.length} onClick={() => void run(() => disconnect(selectedSessions.map(session => session.id)))}>Disconnect selected</button>
            </div>
            {batchEdit && selected.length > 0 && <BatchMachineEdit count={selected.length} busy={busy}
              onClose={() => setBatchEdit(false)} onSave={changes => void run(async () => {
                await saveHosts(hostPath, { ids: selected, changes });
                setBatchEdit(false); setNotice('Selected machines updated.');
              })} />}
          </div>
        </div>
        {catalog.hosts.length > 0 && !shown.length && <p>No machines match your search.</p>}
        {[...groups].sort(([left], [right]) => Number(!left) - Number(!right) || left.localeCompare(right)).map(([group, hosts]) => <section key={group} className="ssh-machine-group">
          <h3>{group || 'Ungrouped'} <small className="muted">{hosts.length}</small></h3>
          <ul className="user-list">{hosts.map(host => {
          const open = connections.filter(session => session.hostId === host.id);
          return <li key={host.id}>
          <div className="ssh-machine-label">
            <input type="checkbox" aria-label={'Select ' + host.name} disabled={busy} checked={selected.includes(host.id)} onChange={event => {
              setSelected(event.target.checked ? [...selected, host.id] : selected.filter(id => id !== host.id));
            }} />
            <div><strong>{host.name}</strong><br /><small className="muted">{host.username}@{host.host}:{host.port}</small>
              {open.length > 0 && <small className="ssh-machine-status">{open.length} open {open.length === 1 ? 'session' : 'sessions'}</small>}</div>
          </div>
          <div className="actions ssh-machine-actions">
            <button aria-label={'Connect to ' + host.name} disabled={busy || !secure} onClick={() => {
              setHostId(String(host.id)); setAuthentication('password'); setObservedKey(undefined); setError('');
            }}>{open.length ? 'New session' : 'Connect'}</button>
            {open.length > 0 && <button aria-label={'Disconnect ' + host.name} disabled={busy} onClick={() => void run(() => disconnect(open.map(session => session.id)))}>Disconnect</button>}
            <button aria-label={'Edit ' + host.name} aria-expanded={editing?.id === host.id} disabled={busy} onClick={() => {
              setEditing(editing?.id === host.id ? undefined : host); setBatchEdit(false); setPendingRemoval(undefined);
            }}>Edit</button>
            <details className="ssh-machine-more"><summary aria-label={'More actions for ' + host.name}>More</summary>
              <div><button disabled={busy} onClick={event => {
                event.currentTarget.closest('details')!.open = false;
                setEditing(undefined); setPendingRemoval(host.id);
              }}>Remove {host.name}</button></div>
            </details>
          </div>
          {editing?.id === host.id && <form key={host.id} aria-label={'Edit machine ' + host.name} className="machine-form ssh-machine-edit" onSubmit={event => {
            event.preventDefault();
            const data = Object.fromEntries(new FormData(event.currentTarget));
            void run(async () => {
              await saveHosts(hostPath + '/' + host.id, { ...data, port: Number(data.port), expected: destination(editing) });
              setEditing(undefined); setNotice('Machine updated.');
            });
          }}>
            <MachineFields host={editing} />
            <p className="muted">Changing connection details closes open sessions. Changing the host or port also clears the trusted fingerprint.</p>
            <div className="actions"><button className="primary" disabled={busy}>Save changes</button>
              <button type="button" disabled={busy} onClick={() => setEditing(undefined)}>Cancel edit</button></div>
          </form>}
          {pendingRemoval === host.id && <div className="account-confirmation"><p>Remove this saved machine?</p>
            <button disabled={busy} onClick={() => void run(async () => {
              await api(hostPath + '/' + host.id, 'DELETE');
              forget(open.map(session => session.id));
              setPendingRemoval(undefined); if (hostId === String(host.id)) setHostId(''); await load();
            })}>Confirm machine removal</button><button onClick={() => setPendingRemoval(undefined)}>Cancel removal</button></div>}
          </li>;
          })}</ul>
        </section>)}
        {!catalog.hosts.length && <p>No saved machines.</p>}
        {selectedHost && secure && !selectedHost.fingerprint && <div className="machine-form" key={hostId}>
          <h3 ref={connectionHeading} tabIndex={-1}>Review host key for {selectedHost.name}</h3>
          <p className="muted">{selectedHost.host}:{selectedHost.port}</p>
          {observedKey?.hostId === selectedHost.id ? <>
            <p><code className="service-address">{observedKey.fingerprint}</code></p>
            <p className="muted">Confirm this is your machine before trusting the key. StackJetty will reject future connections if the key changes.</p>
            <button className="primary" disabled={busy} onClick={() => void run(async () => {
              await api(hostPath + '/' + selectedHost.id + '/trust', 'POST', { fingerprint: observedKey.fingerprint, expected: observedKey.expected });
              setObservedKey(undefined);
              await load();
            })}>Trust key and continue</button>
          </> : <button disabled={busy} onClick={() => void run(async () => {
            const result = await api<{ fingerprint: string; expected: string }>(hostPath + '/' + selectedHost.id + '/probe', 'POST');
            setObservedKey({ hostId: selectedHost.id, ...result });
          })}>{busy ? 'Reading host key…' : 'Read server key'}</button>}
        </div>}
        {selectedHost && secure && selectedHost.fingerprint && <div key={hostId}><form className="machine-form" onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = Object.fromEntries(new FormData(form));
          void run(async () => {
            try {
              await connect(selectedHost, data);
            } finally { form.reset(); }
          });
        }}>
          <h3 ref={connectionHeading} tabIndex={-1}>Connect to {selectedHost.name}</h3>
          <label>Authentication<select aria-label="Authentication" name="authentication" value={authentication} onChange={event => setAuthentication(event.target.value)}>
            <option value="password">Password</option><option value="private-key">Private key</option>
          </select></label>
          {authentication === 'password' ? <label>SSH password<input type="password" name="password" autoComplete="off" maxLength={4096} required /></label>
            : <><label>Session private key<textarea name="privateKey" rows={4} autoComplete="off" spellCheck={false} maxLength={32768} required /></label>
              <label>Key passphrase<input name="passphrase" type="password" autoComplete="off" maxLength={4096} /></label></>}
          <button className="primary" disabled={busy}>{busy ? 'Connecting…' : 'Start SSH session'}</button>
        </form>
          <SavedSshPassword host={selectedHost} connect={password =>
            run(() => connect(selectedHost, { authentication: 'password', password }))} />
        </div>}
      {connections.length > 0 && <>
        <h3>Open sessions</h3>
        <nav className="admin-nav ssh-sessions" aria-label="Open SSH sessions">
          {connections.map(session => <button key={session.id} aria-current={selectedId === session.id ? 'true' : undefined}
            onClick={() => setActiveId(session.id)}>{session.name} · {session.number}</button>)}
        </nav>
        {connections.map(session => <div key={session.id} hidden={selectedId !== session.id}>
          <MachineSession api={api} connection={session} active={visible && selectedId === session.id} busy={busy}
            disconnect={() => run(() => disconnect([session.id]))} />
        </div>)}
      </>}
    </>}
  </section>;
}

function MachineSession({ api, connection, active, busy, disconnect }: {
  api: DiagnosticApi; connection: Connection; active: boolean; busy: boolean; disconnect: () => Promise<void>;
}) {
  const [mode, setMode] = useState('stats');
  const [stats, setStats] = useState<Stats>();
  const [error, setError] = useState('');
  const [shellOpen, setShellOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  useEffect(() => {
    if (!active || mode !== 'stats') return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await api<Stats>('admin/diagnostics/ssh/' + connection.id + '/stats');
        if (mounted) { setStats(result); setError(''); }
      } catch (error) { if (mounted) setError(error instanceof Error ? error.message : 'Machine statistics failed.'); }
      finally { if (mounted) timer = setTimeout(refresh, 5000); }
    }
    void refresh();
    return () => { mounted = false; clearTimeout(timer); };
  }, [active, api, connection.id, mode]);
  return <section className="ssh-session-panel">
    <div className="diagnostic-service-head"><h3>{connection.name}</h3><button disabled={busy} onClick={() => void disconnect()}>Disconnect SSH</button></div>
    <nav className="admin-nav" aria-label="Machine sections">{[['stats', 'Machine statistics'], ['files', 'File browser'], ['shell', 'Shell']].map(([id, label]) =>
      <button key={id} aria-current={mode === id ? 'page' : undefined} onClick={() => {
        setMode(id);
        if (id === 'files') setFilesOpen(true);
      }}>{label}</button>)}</nav>
    {mode === 'stats' && error && <p role="alert" className="error">{error}</p>}
    {mode === 'stats' && (stats ? <>
          <p className="muted diagnostic-system">{stats.system}</p>
          <div className="metric-grid diagnostic-metrics">
            <div><span>CPU</span><strong>{stats.cpuPercent === null ? 'Sampling…' : stats.cpuPercent.toFixed(1) + '%'}</strong><progress aria-label="Remote CPU usage" max={100} value={stats.cpuPercent ?? undefined} /></div>
            <div><span>Memory used</span><strong>{formatBytes(stats.memory.total - stats.memory.available)}</strong><progress aria-label="Remote memory usage" max={stats.memory.total} value={stats.memory.total - stats.memory.available} /></div>
            <div><span>Uptime</span><strong>{formatUptime(stats.uptime)}</strong></div><div><span>Processor cores</span><strong>{stats.cores}</strong></div>
          </div>
          <dl className="metric-grid"><div><dt>Load averages</dt><dd>{stats.load.map(value => value.toFixed(2)).join(' · ')}</dd></div>
            <div><dt>Total memory</dt><dd>{formatBytes(stats.memory.total)}</dd></div><div><dt>Swap used</dt><dd>{formatBytes(stats.memory.swapTotal - stats.memory.swapFree)}</dd></div>
            <div><dt>Network receive</dt><dd>{stats.network.rxPerSecond === null ? 'Sampling…' : formatBytes(stats.network.rxPerSecond) + '/s'}</dd></div>
            <div><dt>Network send</dt><dd>{stats.network.txPerSecond === null ? 'Sampling…' : formatBytes(stats.network.txPerSecond) + '/s'}</dd></div></dl>
          <h3>Filesystems</h3><pre className="diagnostic-output">{stats.disks}</pre>
          <h3>Processes by CPU</h3><pre className="diagnostic-output">{stats.processes}</pre>
        </> : !error && <p>Loading Linux machine statistics…</p>)}
    {filesOpen && <div hidden={mode !== 'files'}><RemoteFiles api={api} sessionId={connection.id} /></div>}
    <div hidden={mode !== 'shell'}>{shellOpen ? <RemoteTerminal api={api} connection={connection} visible={active && mode === 'shell'} /> :
      <button onClick={() => setShellOpen(true)}>Open interactive shell</button>}</div>
  </section>;
}
