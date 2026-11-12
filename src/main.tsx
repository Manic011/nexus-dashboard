import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Boxes, Globe, LayoutGrid, LogOut, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { Administration } from './Administration.js';
import { parseTags } from './tags.js';

type Session = { setup: boolean; setupTokenRequired: boolean; username: string | null; role?: 'admin' | 'editor' | 'viewer' | null; shared?: boolean };
type Jellyfin = { tiles: number[]; state?: 'available' | 'unavailable'; streams?: number };
type Tile = { id: number; title: string; description: string; url: string; category: string; tags: string[] };

async function api<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const result = await fetch('/api/' + path, method === 'GET' ? {} : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload.error);
  return payload;
}

function App() {
  const [session, setSession] = useState<Session>();
  const [jellyfin, setJellyfin] = useState<Jellyfin>();
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sharedLogin, setSharedLogin] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Tile | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Tile | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!session?.username) return;
    let active = true;
    const load = () => {
      void api<Jellyfin>('integrations/jellyfin').then(result => {
        if (active) setJellyfin(result);
      }).catch(() => {
        if (active) setJellyfin(previous => previous && { tiles: previous.tiles, state: 'unavailable' });
      });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => { active = false; clearInterval(timer); setJellyfin(undefined); };
  }, [session?.username, tiles]);
  useEffect(() => { api<Session>('session').then(setSession).catch(report); }, []);
  useEffect(() => {
    if (session?.username) void refresh().catch(report);
  }, [session?.username]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (editing || deleting) element.showModal();
    else element.close();
  }, [editing, deleting]);

  function report(error: unknown) {
    setError(error instanceof Error ? error.message : 'Something went wrong.');
  }
  function refresh() {
    return api<Tile[]>('tiles').then(setTiles);
  }
  async function action(work: () => Promise<void>) {
    setError('');
    setBusy(true);
    try { await work(); } catch (error) { report(error); } finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>, work: (data: object) => Promise<void>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    void action(() => work(data));
  }
  function closeDialog() {
    setEditing(null);
    setDeleting(null);
    setError('');
  }

  const selected = editing === 'new' ? null : editing;
  const categories = new Map(tiles.map(tile => [tile.category.toLowerCase(), tile.category]));
  const tags = new Map(tiles.flatMap(tile => tile.tags.map(tag => [tag.toLowerCase(), tag] as const)));
  const visible = tiles.filter(tile =>
    (!categoryFilter || tile.category.toLowerCase() === categoryFilter) &&
    (!tagFilter || tile.tags.some(tag => tag.toLowerCase() === tagFilter)) &&
    [tile.title, tile.description, tile.category, tile.url, ...tile.tags]
      .some(value => value.toLowerCase().includes(query.trim().toLowerCase())));
  const groups = Map.groupBy(visible, tile => tile.category.toLowerCase());
  function clearFilters() { setQuery(''); setCategoryFilter(''); setTagFilter(''); }
  const warning = error && <p role="alert" className="error">{error}</p>;
  const brand = <span className="brand"><span className="mark"><Boxes size={21} /></span>Nexus <span className="brand-muted">Dashboard</span></span>;

  if (!session?.username) return <main className="auth">
    <section className="auth-card">
      {brand}
      {session ? <>
        <h1>{session.setup ? 'Set up your dashboard' : 'Sign in'}</h1>
        {session.setup && <p className="muted">Create the administrator account for this instance.</p>}
        <form onSubmit={event => submit(event, async data => {
          setSession(await api<Session>(session.setup ? 'setup' : 'login', 'POST', sharedLogin ? { ...data, username: 'shared' } : data));
        })}>
          {!sharedLogin && <label>Username<input name="username" autoComplete="username" maxLength={64} required /></label>}
          <label>Password<input name="password" type="password" autoComplete={session.setup ? 'new-password' : 'current-password'} minLength={session.setup ? 12 : undefined} maxLength={256} required /></label>
          {session.setup && <label>Setup token<input name="token" type="password" autoComplete="off" required /></label>}
          {warning}
          <button className="primary" disabled={busy}>{session.setup ? 'Create account' : 'Sign in'}</button>
        </form>
        {!session.setup && session.shared && <button onClick={() => setSharedLogin(value => !value)}>{sharedLogin ? 'Sign in with a username' : 'Use shared dashboard password'}</button>}
      </> : warning || <p role="status">Loading dashboard…</p>}
    </section>
  </main>;

  return <>
    <header><div className="shell top">{brand}<div className="account">{session.role === 'admin' && <button onClick={() => setAdmin(value => !value)}>{admin ? 'Dashboard' : 'Administration'}</button>}<span>{session.username}</span><button disabled={busy} onClick={() => void action(async () => {
      await api('logout', 'POST');
      setSession(await api<Session>('session'));
      setSharedLogin(false);
      setTiles([]);
      clearFilters();
      setAdmin(false);
    })}><LogOut size={16} /> Sign out</button></div></div></header>
    <main className="shell dashboard">
      {admin ? <><h1>Administration</h1><Administration api={api} onImport={refresh} categories={[...categories.values()]} /></> : <><div className="intro"><div><span className="workspace"><LayoutGrid size={16} /> Workspace</span><h1>Applications</h1><p className="muted">Organize and open the services you use.</p></div>
        {session.role !== 'viewer' && <button className="primary" onClick={() => { setError(''); setEditing('new'); }}><Plus size={19} /> Add tile</button>}
      </div>
      <div className="filters"><label className="search"><Search size={18} /><input type="search" aria-label="Search applications" placeholder="Search applications" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select aria-label="Filter by category" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
          <option value="">All categories</option>{[...categories].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select aria-label="Filter by tag" value={tagFilter} onChange={event => setTagFilter(event.target.value)}>
          <option value="">All tags</option>{[...tags].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        {(query || categoryFilter || tagFilter) && <button onClick={clearFilters}>Clear filters</button>}
      </div>
      {!editing && !deleting && warning}
      {groups.size === 0 && <section className="empty"><Globe size={28} /><h2>{tiles.length ? 'No matching applications' : 'No applications yet'}</h2><p className="muted">{tiles.length ? 'Try a different search or clear your filters.' : 'Add a tile to save a link to your first service.'}</p></section>}
      {[...groups].map(([category, items]) => <section className="group" key={category}>
        <h2>{categories.get(category)} <span className="group-count">{items.length}</span></h2>
        <div className="grid">{items.map(tile => <article key={tile.id} className="tile app-tile">
          <div className="tile-top"><span className="tile-icon"><Globe size={19} /></span>{session.role !== 'viewer' && <div className="actions">
            <button aria-label={'Edit ' + tile.title} onClick={() => { setError(''); setEditing(tile); }}><Pencil size={16} /></button>
            <button aria-label={'Delete ' + tile.title} onClick={() => { setError(''); setDeleting(tile); }}><Trash2 size={16} /></button>
          </div>}</div>
          <a href={tile.url} target="_blank" rel="noopener noreferrer">{tile.title}<ArrowUpRight size={16} /></a>
          <p className="muted">{tile.description || new URL(tile.url).host}</p>
          {tile.tags.length > 0 && <div className="tags">{tile.tags.map(tag => <button key={tag} onClick={() => setTagFilter(tag.toLowerCase())}>{tag}</button>)}</div>}
          {jellyfin?.tiles.includes(tile.id) && <p className="muted">{jellyfin.state === 'available'
            ? `${jellyfin.streams} active ${jellyfin.streams === 1 ? 'stream' : 'streams'}`
            : 'Jellyfin activity unavailable'}</p>}
        </article>)}</div>
      </section>)}
    </>}
    </main>
    <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); if (!busy) closeDialog(); }}>
      {(editing || deleting) && <>
        <div className="dialog-head"><h2 id="dialog-title">{deleting ? 'Delete tile' : selected ? 'Edit tile' : 'Add tile'}</h2><button aria-label="Close" disabled={busy} onClick={closeDialog}><X size={19} /></button></div>
        {deleting ? <form onSubmit={event => submit(event, async () => {
          await api('tiles/' + deleting.id, 'DELETE');
          closeDialog();
          await refresh();
        })}><p>Delete {deleting.title} from your dashboard?</p>{warning}<button className="danger" disabled={busy}>Delete tile</button></form> :
        <form onSubmit={event => submit(event, async data => {
          await api(selected ? 'tiles/' + selected.id : 'tiles', selected ? 'PUT' : 'POST', { ...data, tags: parseTags(String((data as Record<string, unknown>).tags ?? '')) });
          closeDialog();
          clearFilters();
          await refresh();
        })}>
          <label>Name<input name="title" defaultValue={selected?.title} maxLength={80} required /></label>
          <label>URL<input name="url" type="url" placeholder="https://example.com" defaultValue={selected?.url} maxLength={2048} required /></label>
          <label>Category<input name="category" list="existing-categories" defaultValue={selected?.category ?? 'General'} maxLength={40} required /></label>
          <datalist id="existing-categories">{[...categories.values()].map(category => <option key={category} value={category} />)}</datalist>
          <label>Tags <small className="muted">Separate tags with commas.</small><input name="tags" defaultValue={selected?.tags.join(', ')} placeholder="Media, family" maxLength={420} /></label>
          <label>Description<input name="description" defaultValue={selected?.description} maxLength={180} /></label>
          {warning}
          <div className="form-actions"><button type="button" disabled={busy} onClick={closeDialog}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save tile'}</button></div>
        </form>}
      </>}
    </dialog>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
