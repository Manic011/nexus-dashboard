import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { ArrowUpRight, Boxes, Globe, LayoutGrid, LogOut, PanelTop, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { Administration } from './Administration.js';
import { openModes, usePreferences, type OpenMode } from './preferences.js';
import { CategoryPicker } from './CategoryPicker.js';
import { ServiceDialog } from './ServiceDialog.js';
import { CredentialVaultProvider } from './CredentialVault.js';
import { VaultMenu } from './VaultControls.js';
import { LayoutEditor, type CategoryDropProps } from './LayoutEditor.js';
import { TileGrid } from './CategoryDivider.js';
import { categoryName, orderedCategories, orderGroupedTiles, type LayoutCategories } from './layoutCategories.js';
import { arrangeTiles, comparePositions, gridPlacement, tileKey, type Position } from './tileLayout.js';
import { parseTags } from './tags.js';
const Diagnostics = lazy(() => import('./Diagnostics.js').then(module => ({ default: module.Diagnostics })));
const MachineConsole = lazy(() => import('./MachineConsole.js').then(module => ({ default: module.MachineConsole })));

type Session = { setup: boolean; setupTokenRequired: boolean; username: string | null; role?: 'admin' | 'editor' | 'viewer' | null; shared?: boolean };
type Jellyfin = { tiles: number[]; state?: 'available' | 'unavailable'; streams?: number };
type Tile = { id: number; title: string; description: string; url: string; category: string; tags: string[]; openMode?: OpenMode | 'default'; remoteBrowser?: boolean };

async function api<T>(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> {
  const result = await fetch('/api/' + path, method === 'GET' ? { signal } : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal,
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload.error);
  return payload;
}

function App() {
  const [session, setSession] = useState<Session>();
  const preferences = usePreferences(session?.username);
  const [jellyfin, setJellyfin] = useState<Jellyfin>();
  const [tilesLoading, setTilesLoading] = useState(true);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sharedLogin, setSharedLogin] = useState(false);
  const [page, setPage] = useState<'dashboard' | 'administration' | 'diagnostics' | 'ssh'>('dashboard');
  const [sshVisited, setSshVisited] = useState(false);
  const [editingLayout, setEditingLayout] = useState(false);
  const [layoutMessage, setLayoutMessage] = useState('');
  const layoutTrigger = useRef<HTMLButtonElement>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Tile | 'new' | null>(null);
  const [browsing, setBrowsing] = useState<Tile | null>(null);
  const serviceTrigger = useRef<HTMLButtonElement>(null);
  const browsingId = browsing?.id;
  const launchRemote = useCallback(() => api<{ url: string }>('admin/remote-browser/' + browsingId), [browsingId]);
  function openingMode(tile: Tile) {
    return tile.openMode && tile.openMode !== 'default' ? tile.openMode : preferences.value.openMode;
  }
  function serviceLink(tile: Tile, label = tile.title, className = 'tile-launch') {
    return openingMode(tile) === 'new-tab'
      ? <a className={className} href={tile.url} target="_blank" rel="noopener noreferrer">{label}<ArrowUpRight size={16} aria-hidden="true" /></a>
      : <button className={className} aria-haspopup="dialog" onClick={event => {
        serviceTrigger.current = event.currentTarget; setBrowsing(tile);
      }}>{label}<PanelTop size={16} aria-hidden="true" /></button>;
  }
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
    if (!session?.username) return;
    let mounted = true;
    let activity = false;
    let checking = false;
    let lastActivity = Date.now();
    const noteActivity = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== 'visible') return;
      activity = true;
      if (Date.now() - lastActivity >= 10_000) void check();
    };
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const event of events) window.addEventListener(event, noteActivity, { capture: true, passive: true });
    async function check() {
      if (checking) return;
      checking = true;
      try {
        const current = await api<Session>('session');
        if (!mounted) return;
        if (current.username !== session?.username || current.role !== session?.role) {
          setSession(current);
          setSshVisited(false);
          setPage('dashboard');
          setEditing(null); setDeleting(null); setBrowsing(null); setEditingLayout(false); setTiles([]);
          setError(current.username ? '' : 'You were signed out. Sign in to continue.');
          return;
        }
        if (activity) {
          activity = false;
          await api('session/activity', 'POST');
          lastActivity = Date.now();
        }
      } catch { /* Retry on the next check when the connection returns. */ }
      finally { checking = false; }
    }
    const timer = setInterval(() => void check(), 10_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const event of events) window.removeEventListener(event, noteActivity, true);
    };
  }, [session?.username, session?.role]);
  useEffect(() => {
    if (!session?.username) return;
    setTilesLoading(true);
    void refresh().catch(report).finally(() => setTilesLoading(false));
  }, [session?.username]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if ((editing || deleting) && !element.open) {
      element.showModal();
      if (editing) element.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    }
    if (!editing && !deleting) element.close();
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
    if (busy) return;
    const data = Object.fromEntries(new FormData(event.currentTarget));
    void action(() => work(data));
  }
  function closeDialog() {
    setEditing(null);
    setDeleting(null);
    setError('');
  }

  function openTileEditor(tile: Tile | 'new') {
    setError('');
    setTagDraft(tile === 'new' ? '' : tile.tags.join(', '));
    setEditing(tile);
  }

  const selected = editing === 'new' ? null : editing;
  const categories = new Map(tiles.map(tile => [tile.category.toLowerCase(), tile.category]));
  const categorySettings = preferences.value.layoutCategories;
  const tags = new Map(tiles.flatMap(tile => tile.tags.map(tag => [tag.toLowerCase(), tag] as const)));
  const activeCategory = categories.has(categoryFilter) ? categoryFilter : '';
  const activeTag = tags.has(tagFilter) ? tagFilter : '';
  const visible = tiles.filter(tile =>
    (!activeCategory || tile.category.toLowerCase() === activeCategory) &&
    (!activeTag || tile.tags.some(tag => tag.toLowerCase() === activeTag)) &&
    [tile.title, tile.description, tile.category, categoryName(tile.category.toLowerCase(), tile.category, categorySettings), tile.url, ...tile.tags]
      .some(value => value.toLowerCase().includes(query.trim().toLowerCase())));
  const customLayout = preferences.value.tileLayout && arrangeTiles(tiles, preferences.value.tileLayout);
  const customTiles = customLayout && [...visible].sort((a, b) => comparePositions(customLayout.positions[tileKey(a)], customLayout.positions[tileKey(b)]));
  const filtered = Boolean(activeCategory || activeTag || query.trim());
  const draftTags = parseTags(tagDraft);
  const tagSuggestions = draftTags.length < 12 ? [...tags].filter(([key]) => !draftTags.some(tag => tag.toLowerCase() === key)).slice(0, 6) : [];
  function clearFilters() { setQuery(''); setCategoryFilter(''); setTagFilter(''); }
  const warning = error && <p role="alert" className="error">{error}</p>;
  const brand = <span className="brand"><span className="mark"><Boxes size={21} /></span>StackJetty</span>;

  function closeLayout() {
    setEditingLayout(false);
    requestAnimationFrame(() => layoutTrigger.current?.focus());
  }

  function renderTile(tile: Tile, { position, showCategory = Boolean(customLayout), preview = false, overlay, settings = categorySettings, fullRow = false }: {
    position?: Position; showCategory?: boolean; preview?: boolean; overlay?: ReactNode; settings?: LayoutCategories; fullRow?: boolean;
  } = {}) {
    const placement = position && gridPlacement(position);
    const categoryKey = tile.category.toLowerCase();
    const label = categoryName(categoryKey, tile.category, settings);
    return <article key={tile.id} aria-label={preview && !overlay ? tile.title : undefined}
      className={`tile app-tile${overlay ? ' layout-card' : ''}${fullRow ? ' full-row-tile' : ''}`} style={placement && {
      '--tile-row': placement.gridRow, '--tile-column': placement.gridColumn,
    } as CSSProperties}>
      <div inert={preview}>
        <div className="tile-top"><span className="tile-icon"><Globe size={19} /></span>{session?.role !== 'viewer' && <div className="actions">
          <button aria-label={'Edit ' + tile.title} onClick={() => openTileEditor(tile)}><Pencil size={16} /></button>
          <button aria-label={'Delete ' + tile.title} onClick={() => { setError(''); setDeleting(tile); }}><Trash2 size={16} /></button>
        </div>}</div>
        {serviceLink(tile)}
        <p className="muted">{tile.description || new URL(tile.url).host}</p>
        {(showCategory || tile.tags.length > 0) && <div className="tags">
          {showCategory && <button className="tile-category" aria-label={`Category: ${label}`} aria-pressed={!preview && activeCategory === categoryKey} onClick={() => setCategoryFilter(activeCategory === categoryKey ? '' : categoryKey)}>{label}</button>}
          {tile.tags.map(tag => <button key={tag} aria-pressed={!preview && activeTag === tag.toLowerCase()} onClick={() => setTagFilter(activeTag === tag.toLowerCase() ? '' : tag.toLowerCase())}>{tag}</button>)}
        </div>}
        {jellyfin?.tiles.includes(tile.id) && <p className="muted">{jellyfin.state === 'available'
          ? `${jellyfin.streams} active ${jellyfin.streams === 1 ? 'stream' : 'streams'}`
          : 'Jellyfin activity unavailable'}</p>}
      </div>
      {overlay}
    </article>;
  }

  function renderGroups(items: Tile[], preview = false, settings = categorySettings, overlay?: (tile: Tile) => ReactNode,
    dropProps?: (category: string) => CategoryDropProps, categoryControl?: (category: string) => ReactNode) {
    const groups = Map.groupBy(items, tile => tile.category.toLowerCase());
    const wideTiles = new Set(settings.wideTiles);
    return orderedCategories(groups, settings.order).map(category => {
      const group = groups.get(category)!;
      return <section className="group" key={category} {...dropProps?.(category)}>
        <h2 className="category-divider">{categoryName(category, categories.get(category)!, settings)} <span className="group-count">{group.length}</span>{categoryControl?.(category)}</h2>
        <div className="grid">{orderGroupedTiles(group, settings.tileOrder).map(tile => renderTile(tile, { preview, showCategory: false, overlay: overlay?.(tile), fullRow: wideTiles.has(tileKey(tile)) }))}</div>
      </section>;
    });
  }

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

  return <CredentialVaultProvider username={session.username} key={session.username}>
    <header><div className="shell top">{brand}<div className="account">{session.role === 'admin' && <nav className="main-nav" aria-label="Main navigation">
      {([['dashboard', 'Dashboard'], ['diagnostics', 'Diagnostics'], ['ssh', 'SSH machines'], ['administration', 'Administration']] as const).map(([id, label]) =>
        <button key={id} disabled={busy} aria-current={page === id ? 'page' : undefined} onClick={() => {
          if (id === 'ssh') setSshVisited(true);
          setEditingLayout(false); setPage(id);
        }}>{label}</button>)}
    </nav>}<span>{session.username}</span><details className="preferences"><summary>Appearance</summary><div className="preferences-panel">
      <label><span>Theme</span><select aria-label="Theme" value={preferences.value.theme} onChange={event => preferences.update({ theme: event.target.value === 'light' ? 'light' : event.target.value === 'dark' ? 'dark' : 'system' })}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <label><span>Card density</span><select aria-label="Card density" value={preferences.value.density} onChange={event => preferences.update({ density: event.target.value === 'compact' ? 'compact' : 'comfortable' })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
      <label><span>Open tiles by default</span><select aria-label="Open tiles by default" value={preferences.value.openMode} onChange={event => {
        const mode = openModes.find(item => item.value === event.target.value);
        if (mode) preferences.update({ openMode: mode.value });
      }}>{openModes.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></label>
    </div></details>{session.username !== 'shared' && <VaultMenu />}<button disabled={busy} onClick={() => void action(async () => {
      await api('logout', 'POST');
      setSession(await api<Session>('session'));
      setSshVisited(false);
      setSharedLogin(false);
      setTiles([]);
      setBrowsing(null);
      setEditingLayout(false);
      setLayoutMessage('');
      clearFilters();
      setPage('dashboard');
    })}><LogOut size={16} /> Sign out</button></div></div></header>
    <main className="shell dashboard">
      {!editing && !deleting && warning}
      {session.role === 'admin' && sshVisited && <div hidden={page !== 'ssh'}><Suspense fallback={<p role="status">Loading SSH machines…</p>}>
        <MachineConsole api={api} visible={page === 'ssh'} />
      </Suspense></div>}
      {page === 'ssh' ? null : page === 'administration' ? <><h1>Administration</h1><Administration api={api} onImport={refresh} categories={[...categories.values()]} /></>
      : page === 'diagnostics' ? <><h1>Diagnostics</h1><Suspense fallback={<p role="status">Loading diagnostics…</p>}>
        <Diagnostics api={api} serviceLink={(service, label) => serviceLink({ ...service, description: '', tags: [] }, label, 'diagnostic-launch')} />
      </Suspense></> : <><div className="intro"><div><h1>Applications</h1><p className="muted">Organize and open the services you use.</p></div>
        <div className="dashboard-actions">
          <button ref={layoutTrigger} disabled={busy} hidden={!tiles.length || tilesLoading} aria-expanded={editingLayout} onClick={() => {
            setLayoutMessage('');
            setEditingLayout(value => !value);
          }}><LayoutGrid size={18} /> Customize layout</button>
          {session.role !== 'viewer' && !editingLayout && <button className="primary" onClick={() => openTileEditor('new')}><Plus size={19} /> Add tile</button>}
        </div>
      </div>
      {editingLayout ? <LayoutEditor tiles={tiles} categories={categories} tags={tags} initialCategory={activeCategory} initialTag={activeTag} canEditTiles={session.role === 'admin' || session.role === 'editor'} saving={busy}
        renderTile={(tile, position, settings, overlay) => renderTile(tile, { position, overlay, settings, preview: true, showCategory: true })}
        renderGroups={(draftTiles, settings, overlay, dropProps, categoryControl) => renderGroups(draftTiles, true, settings, overlay, dropProps, categoryControl)}
        saved={customLayout} categorySettings={categorySettings} onCancel={closeLayout} onSave={(tileLayout, layoutCategories, moves) => void action(async () => {
        if (moves.length) setTiles(await api<Tile[]>('tiles/categories', 'PATCH', moves));
        const persisted = preferences.update({ tileLayout, layoutCategories });
        setLayoutMessage(persisted ? 'Layout saved.' : 'Layout applied for this session. Browser storage is unavailable.');
        closeLayout();
      })} /> : <>
      {layoutMessage && <p className="layout-notice muted" role="status">{layoutMessage}</p>}
      <div className="filters"><label className="search"><Search size={18} /><input type="search" aria-label="Search applications" placeholder="Search applications" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select aria-label="Filter by category" value={activeCategory} onChange={event => setCategoryFilter(event.target.value)}>
          <option value="">All categories</option>{orderedCategories(categories, categorySettings.order).map(key => <option key={key} value={key}>{categoryName(key, categories.get(key)!, categorySettings)}</option>)}
        </select>
        <select aria-label="Filter by tag" value={activeTag} onChange={event => setTagFilter(event.target.value)}>
          <option value="">All tags</option>{[...tags].map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        {(query || categoryFilter || tagFilter) && <button onClick={clearFilters}>Clear filters</button>}
      </div>
      {tilesLoading && <p role="status">Loading applications…</p>}
      {!tilesLoading && !error && visible.length === 0 && <section className="empty"><Globe size={28} /><h2>{tiles.length ? 'No matching applications' : 'No applications yet'}</h2><p className="muted">{tiles.length ? 'Try a different search or clear your filters.' : session.role === 'viewer' ? 'Applications will appear here when an editor adds them.' : 'Add a tile to save a link to your first service.'}</p></section>}
      {customTiles && customLayout ? filtered
        ? <div className="grid">{customTiles.map(tile => renderTile(tile))}</div>
        : <TileGrid tiles={customTiles} layout={customLayout} categories={categories} settings={categorySettings}
          renderTile={(tile, position) => renderTile(tile, { position })} />
        : renderGroups(visible)}
      </>}
    </>}
    </main>
    {browsing && <ServiceDialog title={browsing.title} url={browsing.url} startRemote={openingMode(browsing) === 'kasm'} launchRemote={browsing.remoteBrowser ? launchRemote : undefined} username={session.username === 'shared' ? undefined : session.username} onClose={() => { setBrowsing(null); serviceTrigger.current?.focus(); }} />}
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
          <label>Name<input name="title" autoFocus autoComplete="off" defaultValue={selected?.title} maxLength={80} required /></label>
          <label>URL<input name="url" type="url" autoComplete="off" spellCheck={false} placeholder="https://example.com" defaultValue={selected?.url} maxLength={2048} required /></label>
          <label>Open this tile<select name="openMode" aria-label="Open this tile" defaultValue={selected?.openMode ?? 'default'}>
            <option value="default">Use my default</option>
            {openModes.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
          </select></label>
          <CategoryPicker categories={[...categories.values()]} initial={selected?.category ?? 'General'} />
          <label>Tags <small className="muted">Use up to 12 comma-separated tags.</small><input name="tags" value={tagDraft} onChange={event => setTagDraft(event.target.value)} placeholder="Media, family" maxLength={420} /></label>
          {tagSuggestions.length > 0 && <div className="tags tag-suggestions" aria-label="Existing tags">{tagSuggestions.map(([key, tag]) => <button type="button" key={key} onClick={() => setTagDraft([...draftTags, tag].join(', '))}>+ {tag}</button>)}</div>}
          <label>Description<input name="description" defaultValue={selected?.description} maxLength={180} /></label>
          {warning}
          <div className="form-actions"><button type="button" disabled={busy} onClick={closeDialog}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save tile'}</button></div>
        </form>}
      </>}
    </dialog>
  </CredentialVaultProvider>;
}

createRoot(document.getElementById('root')!).render(<App />);
