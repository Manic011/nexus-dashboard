import { useEffect, useState } from 'react';
import { DatabaseBackup, Radar, Server, UsersRound } from 'lucide-react';
import { Users } from './Users.js';

type Entry = { title: string; description: string; url: string; category: string };
type Preview = { tiles: Entry[]; skipped: number };
type SystemInfo = { runtime: string; platform: string; schema: number; tiles: number };
type Network = { name: string; address: string; webCidr: string };
type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

const sections = [
  { id: 'discovery', title: 'Discovery', icon: Radar },
  { id: 'users', title: 'Users', icon: UsersRound },
  { id: 'backup', title: 'Backup', icon: DatabaseBackup },
  { id: 'system', title: 'System', icon: Server },
] as const;

export function Administration({ api, onImport }: { api: Api; onImport: () => Promise<void> }) {
  const [section, setSection] = useState<(typeof sections)[number]['id']>('discovery');
  const [interfaces, setInterfaces] = useState<Network[]>([]);
  const [address, setAddress] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [system, setSystem] = useState<SystemInfo>();
  const [preview, setPreview] = useState<Preview>();
  const [selection, setSelection] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const network = interfaces.find(item => item.address === address);

  useEffect(() => {
    api<SystemInfo>('admin/system').then(setSystem).catch(error => setStatus(error.message));
    api<Network[]>('admin/discovery/interfaces').then(setInterfaces).catch(error => setStatus(error.message));
  }, [api]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try {
      await action();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function inspect(input: object) {
    const result = await api<Preview>('admin/backup/preview', 'POST', input);
    setPreview(result);
    setSelection(result.tiles.map(item => item.url));
  }

  return <div className="admin">
    <nav className="admin-nav" aria-label="Administration sections">
      {sections.map(({ id, title, icon: Icon }) => <button key={id} aria-current={section === id ? 'page' : undefined} disabled={busy} onClick={() => {
        setSection(id);
        setPreview(undefined);
        setSelection([]);
        setStatus('');
      }}><Icon size={17} />{title}</button>)}
    </nav>
    {status && <p role="status" className="admin-status">{status}</p>}
    {section === 'users' && <Users api={api} />}
    {section === 'system' && <section className="tile"><h2>System information</h2>
      {system ? <dl><dt>Runtime</dt><dd>{system.runtime}</dd><dt>Platform</dt><dd>{system.platform}</dd><dt>Database schema</dt><dd>{system.schema}</dd><dt>Saved tiles</dt><dd>{system.tiles}</dd></dl> : <p className="muted">Loading system information…</p>}
    </section>}
    {section === 'backup' && <section className="tile"><h2>Dashboard backup</h2><p className="muted">Download your application tiles or merge tiles from a previous export.</p>
      <div className="admin-controls"><a href="/api/admin/backup" download>Download JSON</a>
        <label>Preview a backup<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
          const field = event.currentTarget;
          const file = field.files?.[0];
          field.value = '';
          if (file) void run(async () => {
            setPreview(undefined);
            if (file.size > 2 * 1024 * 1024) throw new Error('Select a backup under 2 MB.');
            await inspect(JSON.parse(await file.text()));
          });
        }} /></label></div>
    </section>}
    {section === 'discovery' && <>
      <section className="tile"><h2>Find services on your network</h2>
        <p className="muted">Discover advertised services and check common web ports. Review the results before adding them to your dashboard.</p>
        <form onSubmit={event => {
          event.preventDefault();
          if (!network || !authorized) return;
          void run(async () => {
            setPreview(undefined);
            setStatus(`Checking ${network.webCidr}. This can take up to 45 seconds.`);
            const result = await api<{ version: 1; tiles: Entry[]; checked: number; total: number; found: number }>(
              'admin/discovery/web', 'POST', { address, authorized },
            );
            await inspect(result);
            const coverage = result.checked < result.total ? ` Checked ${result.checked} of ${result.total} address and port combinations.` : '';
            const limit = result.found > result.tiles.length ? ` Showing the first ${result.tiles.length}.` : '';
            setStatus(result.found ? `Found ${result.found} services.${limit}${coverage}` : `No web services found on ${network.webCidr}.${coverage}`);
          });
        }}>
          <label>Server network<select name="address" required disabled={busy} value={address} onChange={event => {
            setAddress(event.target.value);
            setAuthorized(false);
          }}>
            <option value="">Select a network</option>
            {interfaces.map(item => <option key={item.address} value={item.address}>{item.webCidr} · {item.name}</option>)}
          </select></label>
          {network && <label className="consent"><input type="checkbox" checked={authorized} disabled={busy} onChange={event => setAuthorized(event.target.checked)} /> I have permission to check {network.webCidr}</label>}
          <button className="primary" disabled={busy || !network || !authorized}>{busy ? 'Checking network…' : 'Discover services'}</button>
        </form>
      </section>
      <details className="tile"><summary>Add known service addresses</summary>
        <p className="muted">Paste one HTTP or HTTPS URL per line.</p>
        <form onSubmit={event => {
          event.preventDefault();
          const inventory = String(new FormData(event.currentTarget).get('addresses'));
          void run(async () => {
            setPreview(undefined);
            const tiles = inventory.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(url => {
              const parsed = new URL(url);
              return { url: parsed.href, title: parsed.hostname.slice(0, 80), category: 'Imported services', description: '' };
            });
            await inspect({ version: 1, tiles });
          });
        }}>
          <label>Service addresses<textarea name="addresses" required rows={4} maxLength={100000} /></label>
          <button disabled={busy}>Preview addresses</button>
        </form>
      </details>
    </>}
    {preview && <section className="tile"><h2>Review import</h2>
      <p className="muted">{preview.tiles.length} available · {preview.skipped} duplicate addresses skipped</p>
      {preview.tiles.length > 0 && <>
        <div className="result-actions"><button disabled={busy} onClick={() => setSelection(preview.tiles.map(item => item.url))}>Select all</button>
          <button disabled={busy} onClick={() => setSelection([])}>Clear selection</button></div>
        <div className="result-list">{preview.tiles.map(item => <label className="import-row" key={item.url}>
          <input type="checkbox" checked={selection.includes(item.url)} disabled={busy} onChange={event => {
            setSelection(event.target.checked ? [...selection, item.url] : selection.filter(url => url !== item.url));
          }} /><span><strong>{item.title}</strong><br /><span className="muted">{item.url}</span></span>
        </label>)}</div>
        <button className="primary" disabled={busy || !selection.length} onClick={() => void run(async () => {
          const tiles = preview.tiles.filter(item => selection.includes(item.url));
          const result = await api<{ imported: number; skipped: number }>('admin/backup/import', 'POST', { version: 1, tiles });
          setPreview(undefined);
          setSelection([]);
          setStatus(`Imported ${result.imported} tiles. Skipped ${result.skipped} duplicates.`);
          await onImport();
          setSystem(await api<SystemInfo>('admin/system'));
        })}>Import selected ({selection.length})</button>
      </>}
    </section>}
  </div>;
}
