import { useEffect, useState, type KeyboardEvent } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, Clipboard, Copy, File, Folder, FolderPlus, Link, Pencil, RefreshCw, Scissors, Trash2, Upload } from 'lucide-react';
import { formatBytes, type DiagnosticApi } from './Diagnostics.js';

type Entry = { name: string; directory: boolean; link: boolean; size: number; modified: number };
type Listing = { path: string; entries: Entry[] };
type Source = { directory: string; name: string };
type FileAction = { action: 'mkdir' } | { action: 'rename' | 'delete'; source: Source };
const transferLimit = 4 * 1024 * 1024;

export function RemoteFiles({ api, sessionId }: { api: DiagnosticApi; sessionId: string }) {
  const root = 'admin/diagnostics/ssh/' + sessionId;
  const [listing, setListing] = useState<Listing>();
  const [address, setAddress] = useState('.');
  const [history, setHistory] = useState<string[]>([]);
  const [position, setPosition] = useState(-1);
  const [selection, setSelection] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [clipboard, setClipboard] = useState<{ action: 'copy' | 'move'; source: Source }>();
  const [pending, setPending] = useState<FileAction>();
  const [preview, setPreview] = useState<{ name: string; text: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function run(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); }
    catch (error) { setError(error instanceof Error ? error.message : 'The file operation failed.'); }
    finally { setBusy(false); }
  }
  async function browse(path: string, historyPosition?: number) {
    const next = await api<Listing>(root + '/files', 'POST', { path });
    setListing(next); setAddress(next.path); setSelection(''); setPreview(undefined); setPending(undefined);
    if (historyPosition !== undefined) setPosition(historyPosition);
    else if (next.path !== history[position]) {
      setHistory([...history.slice(0, position + 1), next.path]);
      setPosition(position + 1);
    }
  }
  useEffect(() => { void run(() => browse('.')); }, [api, sessionId]);

  const selected = listing?.entries.find(entry => entry.name === selection);
  const source = listing && selected ? { directory: listing.path, name: selected.name } : undefined;
  const entries = (listing?.entries ?? []).filter(entry => entry.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.directory) - Number(a.directory) ||
      (sort === 'size' ? b.size - a.size : sort === 'modified' ? b.modified - a.modified : 0) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }));
  const open = (entry: Entry) => void run(async () => {
    if (!listing) return;
    const path = listing.path.replace(/\/$/, '') + '/' + entry.name;
    setSelection(entry.name);
    if (entry.directory || entry.link) await browse(path);
    else setPreview({ name: entry.name, text: (await api<{ text: string }>(root + '/file', 'POST', { path })).text });
  });
  function mark(action: 'copy' | 'move') {
    if (!source) return;
    setClipboard({ action, source });
    setMessage((action === 'copy' ? 'Copied ' : 'Cut ') + source.name + '. Open a destination folder and paste.');
  }
  function paste() {
    if (!listing || !clipboard) return;
    void run(async () => {
      await api(root + '/file-operation', 'POST', { ...clipboard, directory: listing.path });
      if (clipboard.action === 'move') setClipboard(undefined);
      await browse(listing.path, position);
      setMessage(clipboard.action === 'move' ? 'Item moved.' : 'Item copied.');
    });
  }
  function keydown(event: KeyboardEvent<HTMLElement>) {
    if (busy || pending || (event.target as HTMLElement).matches('input:not([type="radio"]), select, textarea')) return;
    const shortcut = event.ctrlKey || event.metaKey;
    if (shortcut && event.key.toLowerCase() === 'c' && source && !window.getSelection()?.toString()) { event.preventDefault(); mark('copy'); }
    if (shortcut && event.key.toLowerCase() === 'x' && source) { event.preventDefault(); mark('move'); }
    if (shortcut && event.key.toLowerCase() === 'v' && clipboard) { event.preventDefault(); paste(); }
    if (event.key === 'F2' && source) { event.preventDefault(); setPending({ action: 'rename', source }); }
    if (event.key === 'Delete' && source) { event.preventDefault(); setPending({ action: 'delete', source }); }
  }
  async function download(source: Source) {
    const { data } = await api<{ data: string }>(root + '/file-operation', 'POST', { action: 'download', source });
    const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(data), character => character.charCodeAt(0))], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = source.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  async function upload(file: globalThis.File, directory: string) {
    if (file.size > transferLimit) throw new Error('Uploads are limited to 4 MiB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    await api(root + '/file-operation', 'POST', { action: 'upload', directory, name: file.name, data: btoa(binary) });
    await browse(directory, position);
    setMessage('File uploaded.');
  }

  return <section className="remote-explorer" aria-label="Remote file browser" onKeyDown={keydown}>
    <form className="explorer-address" onSubmit={event => { event.preventDefault(); void run(() => browse(address)); }}>
      <div className="explorer-navigation">
        <button type="button" aria-label="Back" title="Back" disabled={busy || position <= 0} onClick={() => void run(() => browse(history[position - 1], position - 1))}><ArrowLeft size={17} /></button>
        <button type="button" aria-label="Forward" title="Forward" disabled={busy || position >= history.length - 1} onClick={() => void run(() => browse(history[position + 1], position + 1))}><ArrowRight size={17} /></button>
        <button type="button" aria-label="Parent directory" title="Parent directory" disabled={busy || !listing || listing.path === '/'} onClick={() => void run(() => browse(listing!.path + '/..'))}><ArrowUp size={17} /></button>
        <button type="button" aria-label="Refresh folder" title="Refresh folder" disabled={busy || !listing} onClick={() => void run(() => browse(listing!.path, position))}><RefreshCw size={16} /></button>
      </div>
      <input aria-label="Remote path" value={address} onChange={event => setAddress(event.currentTarget.value)} maxLength={4096} required />
      <button disabled={busy}>Open directory</button>
    </form>
    <div className="explorer-toolbar" aria-label="File actions">
      <button disabled={busy || !listing} onClick={() => setPending({ action: 'mkdir' })}><FolderPlus size={16} /> New folder</button>
      <button disabled={busy || !source} onClick={() => mark('copy')}><Copy size={16} /> Copy</button>
      <button disabled={busy || !source} onClick={() => mark('move')}><Scissors size={16} /> Cut</button>
      <button disabled={busy || !listing || !clipboard} onClick={paste}><Clipboard size={16} /> Paste</button>
      <button disabled={busy || !source} onClick={() => source && setPending({ action: 'rename', source })}><Pencil size={16} /> Rename</button>
      <button disabled={busy || !source} onClick={() => source && setPending({ action: 'delete', source })}><Trash2 size={16} /> Delete</button>
      <button disabled={busy || !source || selected?.directory || selected?.link} onClick={() => source && void run(() => download(source))}><ArrowDownToLine size={16} /> Download</button>
      <label className="explorer-upload"><Upload size={16} /> Upload<input aria-label="Upload file" type="file" disabled={busy || !listing} onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (file && listing) void run(() => upload(file, listing.path));
      }} /></label>
    </div>
    {pending && listing && <form className="explorer-confirm" key={pending.action} onSubmit={event => {
      event.preventDefault();
      const name = String(new FormData(event.currentTarget).get('name') ?? '');
      void run(async () => {
        const request = pending.action === 'mkdir' ? { ...pending, directory: listing.path, name }
          : pending.action === 'rename' ? { ...pending, name } : pending;
        await api(root + '/file-operation', 'POST', request);
        setPending(undefined);
        await browse(listing.path, position);
        setMessage(pending.action === 'delete' ? 'Item deleted.' : pending.action === 'rename' ? 'Item renamed.' : 'Folder created.');
      });
    }}>
      {pending.action === 'delete' ? <p>Delete <strong>{pending.source.name}</strong> permanently? If it’s a folder, its contents will also be deleted.</p> :
        <label>{pending.action === 'mkdir' ? 'Folder name' : 'New name'}<input autoFocus required name="name" maxLength={255} defaultValue={pending.action === 'rename' ? pending.source.name : ''} /></label>}
      <button disabled={busy}>{pending.action === 'delete' ? 'Confirm delete' : 'Save name'}</button>
      <button type="button" disabled={busy} onClick={() => setPending(undefined)}>Cancel</button>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="muted" role="status">{message}</p>}
    <div className="explorer-address">
      <input type="search" aria-label="Filter files" placeholder="Filter this folder" value={search} onChange={event => setSearch(event.currentTarget.value)} />
      <select aria-label="Sort files" value={sort} onChange={event => setSort(event.currentTarget.value)}>
        <option value="name">Name</option><option value="size">Size</option><option value="modified">Recently modified</option>
      </select>
    </div>
    <div className="explorer-list" aria-busy={busy}><table>
      <thead><tr><th scope="col">Select</th><th scope="col">Name</th><th scope="col">Size</th><th scope="col">Modified</th></tr></thead>
      <tbody>{entries.map(entry => {
        const Icon = entry.directory ? Folder : entry.link ? Link : File;
        return <tr key={entry.name} className={selection === entry.name ? 'selected' : undefined} onClick={() => { if (!busy) setSelection(entry.name); }}>
          <td><input type="radio" name={'file-' + sessionId} aria-label={'Select ' + entry.name} checked={selection === entry.name} disabled={busy} onChange={() => setSelection(entry.name)} /></td>
          <td><button onClick={() => open(entry)} disabled={busy}><Icon size={17} aria-hidden="true" />{entry.name}</button></td>
          <td>{entry.directory ? '—' : formatBytes(entry.size)}</td><td>{new Date(entry.modified * 1000).toLocaleString()}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {listing && <p className="muted explorer-status">{entries.length} shown{listing.entries.length >= 2000 ? ' · Listing limited to 2,000 items' : ''}{clipboard ? ' · ' + (clipboard.action === 'move' ? 'Cut: ' : 'Copied: ') + clipboard.source.name : ''}</p>}
    {preview && <section><div className="diagnostic-service-head"><h3>{preview.name}</h3><button onClick={() => setPreview(undefined)}>Close preview</button></div>
      <p className="muted">Text preview up to 128 KiB</p><pre className="diagnostic-output">{preview.text}</pre></section>}
  </section>;
}
