import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { formatBytes, formatUptime, type DiagnosticApi } from './Diagnostics.js';
import { VaultForm } from './ServiceDialog.js';

type Host = { id: number; name: string; host: string; port: number; username: string; fingerprint: string };
type Catalog = { enabled: boolean; secureTransport: boolean; hosts: Host[] };
type Connection = { id: string; name: string };
type FileListing = { path: string; entries: { name: string; directory: boolean; link: boolean; size: number; modified: number }[] };
type Stats = {
  system: string; uptime: number; cores: number; cpuPercent: number | null; load: number[];
  memory: { total: number; available: number; swapTotal: number; swapFree: number };
  network: { rx: number; tx: number; rxPerSecond: number | null; txPerSecond: number | null };
  disks: string; processes: string;
};

function RemoteTerminal({ api, connection }: { api: DiagnosticApi; connection: Connection }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
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
    let timer: ReturnType<typeof setTimeout>;
    let cursor = 0;
    let sequence = 0;
    let queue = Promise.resolve();
    let failed = false;
    function sendInput(data: string) {
      for (let start = 0; start < data.length; start += 8192) {
        const chunk = data.slice(start, start + 8192);
        queue = queue.then(async () => {
          if (!active || failed) return;
          try { await api(root + '/input', 'POST', { sequence: ++sequence, data: chunk }); }
          catch { failed = true; if (active) setError('Shell input stopped. Reconnect to continue.'); }
        });
      }
    }
    async function poll() {
      try {
        const response = await api<{ output: string; cursor: number; truncated: boolean; closed: boolean }>(root + '/output', 'POST', { cursor });
        if (!active) return;
        if (response.truncated) terminal.writeln('\r\n[Earlier output was discarded]\r\n');
        terminal.write(response.output);
        cursor = response.cursor;
        if (response.closed) { setError('The remote shell closed.'); return; }
        timer = setTimeout(poll, 250);
      } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Shell connection failed.'); }
    }
    const input = terminal.onData(sendInput);
    const resize = terminal.onResize(size => {
      if (active) void api(root + '/resize', 'POST', { rows: Math.max(2, Math.min(200, size.rows)), columns: Math.max(10, Math.min(300, size.cols)) }).catch(() => {});
    });
    const observer = new ResizeObserver(() => { if (active && container.current?.clientWidth) fit.fit(); });
    observer.observe(container.current);
    void api(root + '/shell', 'POST').then(() => { if (active) {
      terminal.options.disableStdin = false; setReady(true); fit.fit(); terminal.focus(); void poll();
    } })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; clearTimeout(timer); observer.disconnect(); input.dispose(); resize.dispose(); terminal.dispose(); };
  }, [api, connection.id]);
  return <><p role="status">{ready ? 'Shell ready' : 'Opening shell…'}</p><div className="ssh-terminal" ref={container} aria-label={connection.name + ' SSH terminal'} />
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

export function MachineConsole({ api, username }: { api: DiagnosticApi; username: string }) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [hostId, setHostId] = useState('');
  const [connection, setConnection] = useState<Connection>();
  const [mode, setMode] = useState('stats');
  const [stats, setStats] = useState<Stats>();
  const [listing, setListing] = useState<FileListing>();
  const [path, setPath] = useState('.');
  const [file, setFile] = useState<{ path: string; text: string }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<number>();
  const [shellOpen, setShellOpen] = useState(false);
  const [authentication, setAuthentication] = useState('password');
  async function load() { setCatalog(await api('admin/diagnostics/ssh')); }
  useEffect(() => { void load().catch(error => setError(error.message)); }, [api]);
  useEffect(() => {
    if (!connection) return;
    const disconnect = () => {
      void fetch('/api/admin/diagnostics/ssh/' + connection.id, { method: 'DELETE', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    };
    window.addEventListener('pagehide', disconnect);
    return () => { window.removeEventListener('pagehide', disconnect); disconnect(); };
  }, [connection?.id]);
  useEffect(() => {
    if (!connection || mode !== 'stats') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await api<Stats>('admin/diagnostics/ssh/' + connection!.id + '/stats');
        if (active) setStats(result);
      } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Machine statistics failed.'); }
      finally { if (active) timer = setTimeout(refresh, 5000); }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [api, connection?.id, mode]);
  async function run(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : 'SSH operation failed.'); }
    finally { setBusy(false); }
  }
  async function browse(path: string) {
    const result = await api<FileListing>('admin/diagnostics/ssh/' + connection!.id + '/files', 'POST', { path });
    setListing(result); setPath(result.path); setFile(undefined);
  }
  async function connect(credentials: object) {
    const session = await api<Connection>('admin/diagnostics/ssh/connect', 'POST', { ...credentials, hostId: Number(hostId) });
    setStats(undefined); setListing(undefined); setShellOpen(false); setMode('stats'); setConnection(session); setPath('.');
  }
  const selectedHost = catalog?.hosts.find(host => String(host.id) === hostId);
  const secure = window.isSecureContext && catalog?.secureTransport;
  return <section className="tile machine-console">
    <h2>SSH machines</h2>
    <p className="muted">Sign in with the remote machine’s username and password, or a private key. Saved passwords are encrypted in this browser. Connections close after ten minutes without activity or one hour total.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!catalog ? <p>Loading saved machines…</p> : !catalog.enabled ? <p>Enable NEXUS_SSH=on in the server environment to connect machines.</p> : <>
      {!secure && <p className="error">Open StackJetty over HTTPS or through an SSH-encrypted localhost connection to enter SSH credentials.</p>}
      {!connection && <>
        <details><summary>Add SSH machine</summary>
          <p className="muted">Obtain the SHA256 host-key fingerprint from the machine’s trusted console or your administrator. On Linux, use ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub. Use an account with the access you need.</p>
          <form className="machine-form" onSubmit={event => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = Object.fromEntries(new FormData(form));
            void run(async () => {
              await api('admin/diagnostics/ssh/hosts', 'POST', { ...data, port: Number(data.port) });
              await load(); form.reset();
            });
          }}>
            <label>Machine name<input name="name" required maxLength={80} /></label>
            <label>SSH host<input name="host" autoComplete="off" required maxLength={253} placeholder="server.example.com" /></label>
            <label>SSH port<input name="port" type="number" defaultValue={22} min={1} max={65535} required /></label>
            <label>SSH username<input name="username" autoComplete="off" required maxLength={64} /></label>
            <label>Trusted host fingerprint<input name="fingerprint" autoComplete="off" placeholder="SHA256:…" required /></label>
            <button disabled={busy}>Save machine</button>
          </form>
        </details>
        <ul className="user-list">{catalog.hosts.map(host => <li key={host.id}>
          <div><strong>{host.name}</strong><br /><small className="muted">{host.username}@{host.host}:{host.port}</small></div>
          <div className="actions"><button disabled={busy || !secure} onClick={() => { setHostId(String(host.id)); setAuthentication('password'); setError(''); }}>Connect to {host.name}</button>
            <button disabled={busy} onClick={() => setPendingRemoval(host.id)}>Remove {host.name}</button></div>
          {pendingRemoval === host.id && <div className="account-confirmation"><p>Remove this saved machine?</p>
            <button disabled={busy} onClick={() => void run(async () => {
              await api('admin/diagnostics/ssh/hosts/' + host.id, 'DELETE');
              const key = sshVaultKey(username, host.id);
              try {
                if (navigator.locks) await navigator.locks.request(key, () => localStorage.removeItem(key));
                else localStorage.removeItem(key);
              } finally { setPendingRemoval(undefined); setHostId(''); await load(); }
            })}>Confirm machine removal</button><button onClick={() => setPendingRemoval(undefined)}>Cancel removal</button></div>}
        </li>)}</ul>
        {!catalog.hosts.length && <p>No saved machines.</p>}
        {selectedHost && secure && <div key={hostId}><form className="machine-form" onSubmit={event => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = Object.fromEntries(new FormData(form));
          void run(async () => {
            try {
              await connect(data);
            } finally { form.reset(); }
          });
        }}>
          <h3>Connect to {selectedHost.name}</h3>
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
      </>}
      {connection && <>
        <div className="diagnostic-service-head"><h3>{connection.name}</h3><button disabled={busy} onClick={() => void run(async () => {
          await api('admin/diagnostics/ssh/' + connection.id, 'DELETE'); setConnection(undefined); setStats(undefined); setFile(undefined);
        })}>Disconnect SSH</button></div>
        <nav className="admin-nav" aria-label="Machine sections">{[['stats', 'Machine statistics'], ['files', 'File browser'], ['shell', 'Shell']].map(([id, label]) =>
          <button key={id} disabled={busy} aria-current={mode === id ? 'page' : undefined} onClick={() => {
            setMode(id); setError('');
            if (id === 'files' && !listing) void run(() => browse('.'));
          }}>{label}</button>)}</nav>
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
        </> : <p>Loading Linux machine statistics…</p>)}
        {mode === 'files' && <>
          <form className="admin-controls" onSubmit={event => { event.preventDefault(); void run(() => browse(path)); }}>
            <label>Remote path<input value={path} onChange={event => setPath(event.target.value)} maxLength={4096} /></label>
            <button disabled={busy}>Open directory</button>
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              const result = await api<{ text: string }>('admin/diagnostics/ssh/' + connection.id + '/file', 'POST', { path });
              setFile({ path, text: result.text });
            })}>Preview file</button>
            <button type="button" disabled={busy || !listing} onClick={() => void run(() => browse(listing!.path + '/..'))}>Parent directory</button>
          </form>
          {listing && <><p className="muted diagnostic-url">{listing.path} · up to 2,000 entries</p>
            <ul className="user-list remote-files">{[...listing.entries].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)).map(entry =>
              <li key={entry.name}><button disabled={busy} onClick={() => void run(async () => {
                const target = listing.path.replace(/\/$/, '') + '/' + entry.name;
                if (entry.directory || entry.link) await browse(target);
                else {
                  const result = await api<{ text: string }>('admin/diagnostics/ssh/' + connection.id + '/file', 'POST', { path: target });
                  setFile({ path: target, text: result.text });
                }
              })}>{entry.directory ? '▸ ' : entry.link ? '↗ ' : ''}{entry.name}</button>
                <small className="muted">{formatBytes(entry.size)} · {new Date(entry.modified * 1000).toLocaleString()}</small></li>)}</ul></>}
          {file && <section><h3 className="diagnostic-url">{file.path}</h3><p className="muted">Text preview, up to 128 KiB</p><pre className="diagnostic-output">{file.text}</pre></section>}
        </>}
        <div hidden={mode !== 'shell'}>{shellOpen ? <RemoteTerminal api={api} connection={connection} /> : <>
          <p className="muted">The shell runs commands with this SSH account’s permissions. Commands can change the remote machine.</p>
          <button disabled={busy} onClick={() => setShellOpen(true)}>Open interactive shell</button>
        </>}</div>
      </>}
    </>}
  </section>;
}
