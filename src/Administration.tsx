import { useEffect, useState } from 'react';

type Entry = { title: string; description: string; url: string; category: string };
type Preview = { tiles: Entry[]; skipped: number };
type SystemInfo = { runtime: string; platform: string; schema: number; tiles: number };
type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

export function Administration({ api, onImport }: { api: Api; onImport: () => Promise<void> }) {
  const [system, setSystem] = useState<SystemInfo>();
  const [preview, setPreview] = useState<Preview>();
  const [selection, setSelection] = useState<Entry[]>([]);
  const [inventory, setInventory] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SystemInfo>('admin/system').then(setSystem).catch(error => setStatus(error.message));
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
    setPreview(undefined);
    setSelection([]);
    const result = await api<Preview>('admin/backup/preview', 'POST', input);
    setPreview(result);
    setSelection(result.tiles);
  }

  return <div className="admin">
    <section className="tile"><h2>System information</h2>
      {system ? <dl><dt>Runtime</dt><dd>{system.runtime}</dd><dt>Platform</dt><dd>{system.platform}</dd><dt>Database schema</dt><dd>{system.schema}</dd><dt>Saved tiles</dt><dd>{system.tiles}</dd></dl> : <p className="muted">Loading system information…</p>}
    </section>
    <section className="tile"><h2>Dashboard backup</h2><p className="muted">Download your application tiles or merge tiles from a previous export.</p>
      <div className="admin-controls"><a className="download" href="/api/admin/backup" download>Download JSON</a>
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
    </section>
    <section className="tile"><h2>Import service addresses</h2><p className="muted">Paste HTTP or HTTPS service addresses, one per line. Nexus uses the hostname as the starting name.</p>
      <form onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          setPreview(undefined);
          const addresses = inventory.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
          const tiles = addresses.map(url => {
            const parsed = new URL(url);
            return { url: parsed.href, title: parsed.hostname.slice(0, 80), category: 'Imported services', description: '' };
          });
          await inspect({ version: 1, tiles });
        });
      }}>
        <label>Service addresses<textarea required rows={4} maxLength={100000} value={inventory} onChange={event => setInventory(event.target.value)} /></label>
        <button disabled={busy}>Preview services</button>
      </form>
    </section>
    {preview && <section className="tile"><h2>Import preview</h2>
      <p className="muted">{preview.tiles.length} new tiles · {preview.skipped} duplicate addresses skipped</p>
      {preview.tiles.map(item => <label className="import-row" key={item.url}>
        <input type="checkbox" checked={selection.includes(item)} disabled={busy} onChange={event => {
          setSelection(event.target.checked ? [...selection, item] : selection.filter(value => value !== item));
        }} /><span><strong>{item.title}</strong><br />{item.url}</span>
      </label>)}
      <button className="primary" disabled={busy || !selection.length} onClick={() => void run(async () => {
        const result = await api<{ imported: number; skipped: number }>('admin/backup/import', 'POST', { version: 1, tiles: selection });
        setPreview(undefined);
        setSelection([]);
        setStatus(`Imported ${result.imported} tiles. Skipped ${result.skipped} duplicates.`);
        await onImport();
        setSystem(await api<SystemInfo>('admin/system'));
      })}>Import selected</button>
    </section>}
    {status && <p role="status">{status}</p>}
  </div>;
}
