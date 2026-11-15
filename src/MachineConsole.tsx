import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { formatBytes, formatUptime, type DiagnosticApi } from './Diagnostics.js';
import { VaultForm } from './ServiceDialog.js';
import { RemoteFiles } from './RemoteFiles.js';

type Host = { id: number; name: string; host: string; port: number; username: string; fingerprint?: string };
type Catalog = { enabled: boolean; secureTransport: boolean; hosts: Host[] };
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

function sshVaultKey(username: string, id: number) {
  return 'nexus.ssh.vault.v1:' + username + ':' + id;
}

function SavedSshPassword({ username, host, connect }: {
  username: string; host: Host; connect: (password: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const address = 'ssh:' + JSON.stringify([host.host.toLowerCase(), host.port, host.username, host.fingerprint]);
  return <details className="credential-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Saved SSH password</summary>
    {open && (window.crypto?.subtle && navigator.locks ? <>
      <p className="muted">Protect this machine’s password with a vault password. It is encrypted for your account in this browser.</p>
      <VaultForm username={username} address={address} storageKey={sshVaultKey(username, host.id)} fixedUsername={host.username}
        onUse={credential => connect(credential.password)} />
    </> : <p className="muted">Use a current browser with Web Crypto and Web Locks to save SSH passwords.</p>)}
  </details>;
}

export function MachineConsole({ api, username, visible }: { api: DiagnosticApi; username: string; visible: boolean }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [hostId, setHostId] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeId, setActiveId] = useState('');
  const sessionIds = useRef(new Set<string>());
  const mounted = useRef(false);
  const nextNumber = useRef(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<number>();
  const [authentication, setAuthentication] = useState('password');
  const [observedKey, setObservedKey] = useState<{ hostId: number; fingerprint: string }>();
  const addMachineDetails = useRef<HTMLDetailsElement>(null);
  const connectionHeading = useRef<HTMLHeadingElement>(null);
  async function load() { setCatalog(await api('admin/diagnostics/ssh')); }
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
    setBusy(true); setError('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : 'SSH operation failed.'); }
    finally { setBusy(false); }
  }
  async function connect(credentials: object) {
    const targetId = Number(hostId);
    const result = await api<{ id: string; name: string }>('admin/diagnostics/ssh/connect', 'POST', { ...credentials, hostId: targetId });
    if (!mounted.current) { release(result.id); return; }
    const session = { ...result, hostId: targetId, number: ++nextNumber.current };
    sessionIds.current.add(session.id);
    setConnections(current => [...current, session]);
    setActiveId(session.id);
    setHostId('');
  }
  function forget(id: string) {
    sessionIds.current.delete(id);
    setConnections(current => current.filter(session => session.id !== id));
  }
  const selectedId = connections.some(session => session.id === activeId) ? activeId : connections.at(-1)?.id;
  const selectedHost = catalog?.hosts.find(host => String(host.id) === hostId);
  const secure = window.isSecureContext && catalog?.secureTransport;
  useEffect(() => {
    if (visible && selectedHost && secure) connectionHeading.current?.focus();
  }, [selectedHost?.id, selectedHost?.fingerprint, secure, visible]);
  return <section className="tile machine-console">
    <h2>SSH machines</h2>
    <p className="muted">Sign in with the remote machine’s username and password, or a private key. Saved passwords are encrypted in this browser. Sessions stay open while you switch views. Signing out closes all sessions.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!catalog ? <p>Loading saved machines…</p> : !catalog.enabled ? <p>Enable NEXUS_SSH=on in the server environment to connect machines.</p> : <>
      {!secure && <p className="error">Open StackJetty over HTTPS or through an SSH-encrypted localhost connection to enter SSH credentials.</p>}
        <details ref={addMachineDetails}><summary>Add SSH machine</summary>
          <p className="muted">Leave the fingerprint blank to review the server’s key on your first connection.</p>
          <form className="machine-form" onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = Object.fromEntries(new FormData(form));
            void run(async () => {
              const saved = await api<{ id: number }>('admin/diagnostics/ssh/hosts', 'POST', { ...data, port: Number(data.port) });
              form.reset();
              await load();
              if (secure) {
                if (addMachineDetails.current) addMachineDetails.current.open = false;
                setAuthentication('password');
                setHostId(String(saved.id));
              }
            });
          }}>
            <label>Machine name<input name="name" required maxLength={80} /></label>
            <label>SSH host<input name="host" autoComplete="off" required maxLength={253} placeholder="server.example.com" /></label>
            <label>SSH port<input name="port" type="number" defaultValue={22} min={1} max={65535} required /></label>
            <label>SSH username<input name="username" autoComplete="off" required maxLength={64} /></label>
            <label>Trusted host fingerprint (optional)<input name="fingerprint" autoComplete="off" placeholder="SHA256:…" /></label>
            <p className="muted">{secure ? 'You’ll continue to the connection setup.' : 'Save the machine here, then use HTTPS or the SSH tunnel to connect.'}</p>
            <button disabled={busy}>{secure ? 'Save machine and continue' : 'Save machine'}</button>
          </form>
        </details>
        <ul className="user-list">{catalog.hosts.map(host => <li key={host.id}>
          <div><strong>{host.name}</strong><br /><small className="muted">{host.username}@{host.host}:{host.port}</small></div>
          <div className="actions"><button disabled={busy || !secure} onClick={() => { setHostId(String(host.id)); setAuthentication('password'); setError(''); }}>Connect to {host.name}</button>
            <button disabled={busy} onClick={() => setPendingRemoval(host.id)}>Remove {host.name}</button></div>
          {pendingRemoval === host.id && <div className="account-confirmation"><p>Remove this saved machine?</p>
            <button disabled={busy} onClick={() => void run(async () => {
              await api('admin/diagnostics/ssh/hosts/' + host.id, 'DELETE');
              for (const session of connections) if (session.hostId === host.id) sessionIds.current.delete(session.id);
              setConnections(current => current.filter(session => session.hostId !== host.id));
              const key = sshVaultKey(username, host.id);
              try {
                if (navigator.locks) await navigator.locks.request(key, () => localStorage.removeItem(key));
                else localStorage.removeItem(key);
              } finally { setPendingRemoval(undefined); setHostId(''); await load(); }
            })}>Confirm machine removal</button><button onClick={() => setPendingRemoval(undefined)}>Cancel removal</button></div>}
        </li>)}</ul>
        {!catalog.hosts.length && <p>No saved machines.</p>}
        {selectedHost && secure && !selectedHost.fingerprint && <div className="machine-form" key={hostId}>
          <h3 ref={connectionHeading} tabIndex={-1}>Review host key for {selectedHost.name}</h3>
          <p className="muted">{selectedHost.host}:{selectedHost.port}</p>
          {observedKey?.hostId === selectedHost.id ? <>
            <p><code className="service-address">{observedKey.fingerprint}</code></p>
            <p className="muted">Confirm this is your machine before trusting the key. StackJetty will reject future connections if the key changes.</p>
            <button className="primary" disabled={busy} onClick={() => void run(async () => {
              await api('admin/diagnostics/ssh/hosts/' + selectedHost.id + '/trust', 'POST', { fingerprint: observedKey.fingerprint });
              setObservedKey(undefined);
              await load();
            })}>Trust key and continue</button>
          </> : <button disabled={busy} onClick={() => void run(async () => {
            const result = await api<{ fingerprint: string }>('admin/diagnostics/ssh/hosts/' + selectedHost.id + '/probe', 'POST');
            setObservedKey({ hostId: selectedHost.id, fingerprint: result.fingerprint });
          })}>{busy ? 'Reading host key…' : 'Read server key'}</button>}
        </div>}
        {selectedHost && secure && selectedHost.fingerprint && <div key={hostId}><form className="machine-form" onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = Object.fromEntries(new FormData(form));
          void run(async () => {
            try {
              await connect(data);
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
          <SavedSshPassword username={username} host={selectedHost} connect={password =>
            run(() => connect({ authentication: 'password', password }))} />
        </div>}
      {connections.length > 0 && <>
        <h3>Open sessions</h3>
        <nav className="admin-nav ssh-sessions" aria-label="Open SSH sessions">
          {connections.map(session => <button key={session.id} aria-current={selectedId === session.id ? 'true' : undefined}
            onClick={() => setActiveId(session.id)}>{session.name} · {session.number}</button>)}
        </nav>
        {connections.map(session => <div key={session.id} hidden={selectedId !== session.id}>
          <MachineSession api={api} connection={session} active={visible && selectedId === session.id} busy={busy}
            disconnect={() => run(async () => {
              try { await api('admin/diagnostics/ssh/' + session.id, 'DELETE'); }
              catch { release(session.id); }
              finally { forget(session.id); }
            })} />
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
