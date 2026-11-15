import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Activity, DatabaseBackup, Radar, Server, UsersRound } from 'lucide-react';
const Diagnostics = lazy(() => import('./Diagnostics.js').then(module => ({ default: module.Diagnostics })));
import { AdminWorkspace } from './AdminWorkspace.js';
import { Users } from './Users.js';
import { ImportCategory } from './ImportCategory.js';
import { ScanField } from './ScanField.js';
import { parseTags } from './tags.js';

type Entry = { title: string; description: string; url: string; category: string; tags?: string[]; source?: string };
type Preview = { tiles: Entry[]; skipped: number; existing?: Entry[]; revision?: string };
type Profile = { id: number; name: string; address: string; range: string; exclude: string; ports: string };
type Coverage = { checked: number; total: number };
type SystemInfo = { discoveryEnabled: boolean; runtime: string; platform: string; schema: number; tiles: number; hostname: string; kernel: string; architecture: string; cpu: string; logicalCpus: number; totalMemory: number; freeMemory: number; machineUptime: number; serviceUptime: number; serviceMemory: number };
type Network = { name: string; address: string; webCidr: string; exampleRange: string };
type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

const sections = [
  { id: 'discovery', title: 'Discovery', icon: Radar },
  { id: 'users', title: 'Users', icon: UsersRound },
  { id: 'backup', title: 'Backup', icon: DatabaseBackup },
  { id: 'system', title: 'System', icon: Server },
  { id: 'diagnostics', title: 'Diagnostics', icon: Activity },
] as const;

export function Administration({ api, onImport, categories }: { api: Api; onImport: () => Promise<void>; categories: string[] }) {
  const [section, setSection] = useState<(typeof sections)[number]['id']>('discovery');
  const [interfaces, setInterfaces] = useState<Network[]>([]);
  const [address, setAddress] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileName, setProfileName] = useState('');
  const [filter, setFilter] = useState('');
  const [comparison, setComparison] = useState<{ added: string[]; missing: string[]; changed: string[] } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [scope, setScope] = useState({ range: [''], exclude: [''], ports: [''] });
  const [plan, setPlan] = useState<{ hosts: number; ports: number[]; checks: number }>();
  function changeScope(field: keyof typeof scope, value: string[]) {
    setScope(previous => ({ ...previous, [field]: value }));
    resetPlan();
  }
  const scanFields = {
    range: scope.range.map(value => value.trim()).filter(Boolean).join(','),
    exclude: scope.exclude.map(value => value.trim()).filter(Boolean).join(','),
    ports: scope.ports.map(value => value.trim()).filter(Boolean).join(','),
  };
  function resetPlan() { setPlan(undefined); setAuthorized(false); }
  const [authorized, setAuthorized] = useState(false);
  const [system, setSystem] = useState<SystemInfo>();
  const [scanning, setScanning] = useState(false);
  const [coverage, setCoverage] = useState<Coverage>();
  const [preview, setPreview] = useState<Preview>();
  const [edits, setEdits] = useState<Record<string, { title: string; category: string; tags: string; description: string }>>({});
  const [selection, setSelection] = useState<string[]>([]);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [status, setStatus] = useState('');
  const review = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const network = interfaces.find(item => item.address === address);

  useEffect(() => {
    api<SystemInfo>('admin/system').then(setSystem).catch(error => setStatus(error.message));
  }, [api]);

  const discoveryEnabled = system?.discoveryEnabled;
  useEffect(() => {
    if (!discoveryEnabled) return;
    api<Profile[]>('admin/discovery/profiles').then(setProfiles).catch(error => setStatus(error.message));
    api<Network[]>('admin/discovery/interfaces').then(setInterfaces).catch(error => setStatus(error.message));
  }, [api, discoveryEnabled]);

  useEffect(() => { if (preview) review.current?.focus(); }, [preview]);

  useEffect(() => {
    if (!scanning) return;
    let active = true;
    const timer = setInterval(() => {
      void api<{ progress: Coverage | null }>('admin/discovery/progress').then(({ progress }) => {
        if (active && progress) setCoverage(progress);
      }).catch(() => {});
    }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [api, scanning]);

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
    const entries = (input as { tiles?: Entry[] }).tiles ?? [];
    const sources = new Map(entries.map(item => [item.url, item.source]));
    const all = [...result.tiles, ...(result.existing ?? [])];
    const unique = [...new Map(all.map(item => [new URL(item.url).href, item])).values()];
    setEdits(Object.fromEntries(unique.map(item => [item.url, { title: item.title, category: item.category, tags: item.tags?.join(', ') ?? '', description: item.description }])));
    setPreview({ ...result, tiles: unique.map(item => ({ ...item, source: sources.get(item.url) })) });
    setSelection(result.tiles.map(item => item.url));
    setFilter('');
    setComparison((input as { comparison?: typeof comparison }).comparison ?? null);

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
    {section === 'users' && <Users api={api} onChange={() => setWorkspaceRevision(value => value + 1)} />}
    {section === 'diagnostics' && <Suspense fallback={<p role="status">Loading diagnostics…</p>}><Diagnostics api={api} /></Suspense>}
    {section === 'system' && <section className="tile"><h2>System information</h2>
      {system ? <dl><dt>Runtime</dt><dd>{system.runtime}</dd><dt>Platform</dt><dd>{system.platform}</dd><dt>Database schema</dt><dd>{system.schema}</dd><dt>Saved tiles</dt><dd>{system.tiles}</dd><dt>Host</dt><dd>{system.hostname}</dd><dt>Kernel and architecture</dt><dd>{system.kernel} · {system.architecture}</dd><dt>Processor</dt><dd>{system.cpu} · {system.logicalCpus} logical cores</dd><dt>Memory</dt><dd>{Math.round(system.freeMemory / 1048576)} MiB free of {Math.round(system.totalMemory / 1048576)} MiB</dd><dt>Service memory</dt><dd>{Math.round(system.serviceMemory / 1048576)} MiB</dd><dt>Uptime</dt><dd>Host {Math.floor(system.machineUptime / 60)} min · StackJetty {Math.floor(system.serviceUptime / 60)} min</dd></dl> : <p className="muted">Loading system information…</p>}
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
        {discoveryEnabled === false && <p className="muted">Network discovery is disabled on this server. You can still review previous results and add known addresses.</p>}
        {discoveryEnabled && <>
        <p className="muted">Scan private networks reachable from this server. Live page identification takes priority over port suggestions. Review every result before changing your dashboard.</p>
        <div className="scan-profiles"><label>Saved scan profile<select disabled={busy} defaultValue="" onChange={event => {
          const profile = profiles.find(item => item.id === Number(event.target.value));
          if (!profile) return;
          setAddress(profile.address); setProfileName(profile.name);
          setScope({ range: profile.range.split(','), exclude: profile.exclude.split(','), ports: profile.ports.split(',') }); resetPlan();
        }}><option value="">Choose a saved profile</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label></div>
        {scanning && <button type="button" disabled={cancelling} onClick={() => {
          setCancelling(true); void api('admin/discovery/cancel', 'POST').catch(error => { setStatus(error.message); setCancelling(false); });
        }}>{cancelling ? 'Stopping…' : 'Stop scan'}</button>}
        {scanning && <p><progress aria-label="Discovery checks" max={coverage?.total} value={coverage?.checked} /> {coverage ? `${coverage.checked} / ${coverage.total} checks` : 'Starting scan…'}</p>}
        <form onSubmit={event => {
          event.preventDefault();
          if (!network || !plan || !authorized) return;
          void run(async () => {
            setPreview(undefined);
            setStatus(`Scanning the reviewed targets. Larger ranges can take several minutes.`);
            setScanning(true);
            setCoverage(undefined);
            setCancelling(false);
            const result = await api<{ version: 1; tiles: Entry[]; checked: number; total: number; found: number; cancelled: boolean; comparison: typeof comparison }>(
              'admin/discovery/web', 'POST', { address, authorized, ...scanFields },
            ).finally(() => setScanning(false));
            setComparison(result.comparison);
            await inspect(result);
            setWorkspaceRevision(value => value + 1);
            const coverage = ` Checked ${result.checked} of ${result.total} address and port combinations.`;
            const limit = result.found > result.tiles.length ? ` Showing the first ${result.tiles.length}.` : '';
            const completion = result.cancelled ? 'Stopped' : result.checked < result.total ? 'Partial' : 'Complete';
            setStatus(completion + '. ' + (result.found ? `Found ${result.found} services.${limit}${coverage}` : `No web services responded in the reviewed scope.${coverage}`));
          });
        }}>
          <label>Server network<select name="address" required disabled={busy} value={address} onChange={event => {
            setAddress(event.target.value);
            setScope(previous => ({ ...previous, range: [''], exclude: [''] }));
            resetPlan();
          }}>
            <option value="">Select a network</option>
            {interfaces.map(item => <option key={item.address} value={item.address}>{item.webCidr} · {item.name}</option>)}
          </select></label>
          {network && <>
            <ScanField label="IP addresses or ranges" value={scope.range} disabled={busy} placeholder="Entire displayed range"
              onChange={value => changeScope('range', value)} presets={[
                { label: 'Entire subnet', value: '' },
                { label: 'StackJetty server only', value: network.address },
                { label: 'Start of subnet', value: network.exampleRange },
              ]} />
            <ScanField label="Excluded IPs or ranges" value={scope.exclude} disabled={busy} placeholder="None"
              onChange={value => changeScope('exclude', value)} presets={[
                { label: 'No exclusions', value: '' },
                { label: 'Exclude StackJetty server', value: network.address },
              ]} />
            <ScanField label="Ports or port ranges" value={scope.ports} disabled={busy} placeholder="Common homelab ports"
              onChange={value => changeScope('ports', value)} presets={[
                { label: 'Common homelab ports', value: '' },
                { label: 'Standard web', value: '80, 443' },
                { label: 'Media servers', value: '8096, 8920, 32400' },
                { label: 'Proxmox', value: '8006-8007' },
                { label: 'Alternative web', value: '8080-8082, 8443' },
              ]} />
            <p className="muted">Add a row for each entry. Use single IPv4 addresses, CIDRs (e.g. 192.168.1.0/24), or start–end ranges. Multiple private subnets are supported, up to 4096 addresses; routing and firewalls determine reachability.</p>
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              setPlan(await api<typeof plan>('admin/discovery/plan', 'POST', { address, ...scanFields }));
            })}>Review scan scope</button>
          </>}
          {network && <div className="profile-save"><label>Profile name<input value={profileName} maxLength={80} disabled={busy} onChange={event => setProfileName(event.target.value)} placeholder="e.g. Media and infrastructure" /></label>
            <button type="button" disabled={busy || !profileName.trim()} onClick={() => void run(async () => {
              await api('admin/discovery/plan', 'POST', { address, ...scanFields });
              await api('admin/discovery/profiles', 'POST', { name: profileName, address, ...scanFields });
              setProfiles(await api<Profile[]>('admin/discovery/profiles')); setStatus('Scan profile saved. Saving the same name replaces its settings.');
            })}>Save profile</button></div>}
          {plan && <p role="status">{plan.hosts} addresses · {plan.ports.length} ports · {plan.checks.toLocaleString()} checks</p>}
          {network && plan && <label className="consent"><input type="checkbox" checked={authorized} disabled={busy} onChange={event => setAuthorized(event.target.checked)} /> I have permission to scan all targets in this reviewed scope</label>}
          <button className="primary" disabled={busy || !network || !plan || !authorized}>{busy ? 'Checking network…' : 'Discover services'}</button>
        </form>
        </>}
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
    {section !== 'diagnostics' && <AdminWorkspace key={section + workspaceRevision} section={section} api={api} refresh={async () => { await onImport(); setSystem(await api<SystemInfo>('admin/system')); }} inspect={inspect} />}
    {section === 'discovery' && comparison && <details className="tile"><summary>Changes since the previous complete scan of the same targets</summary>
      <p className="muted">Missing means no response during this scan; it does not prove a service is offline. Tiles are never removed automatically.</p>
      {(['added', 'changed', 'missing'] as const).map(kind => <div key={kind}><h3>{kind[0].toUpperCase() + kind.slice(1)} ({comparison[kind].length})</h3><ul>{comparison[kind].map(url => <li key={url}>{url}</li>)}</ul></div>)}
    </details>}
    {preview && <section className="tile" ref={review} tabIndex={-1} aria-labelledby="review-title"><h2 id="review-title">Review import</h2>
      {preview.tiles.length === 0 && <p>No new tiles to import.</p>}
      <p className="muted">{preview.tiles.length} unique services · {preview.existing?.length ?? 0} already on dashboard</p>
      {!!preview.existing?.length && <p className="muted">Existing tiles are unselected by default. Select an existing tile to replace its name, category, tags, and description. Permissions and tile IDs stay intact.</p>}
      {preview.tiles.length > 0 && <>
        <label>Filter results<input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search name, URL, category, or evidence" /></label>
        <div className="result-actions"><button disabled={busy} onClick={() => setSelection(preview.tiles.filter(item => !preview.existing?.some(saved => saved.url === item.url)).map(item => item.url))}>Select new</button>
          <button disabled={busy} onClick={() => setSelection([])}>Clear selection</button></div>
        <form className="review-form" onSubmit={event => {
          event.preventDefault();
          void run(async () => {
            const tiles = preview.tiles.filter(item => selection.includes(item.url)).map(item => {
              const { title, category, tags, description } = edits[item.url];
              return { ...item, title, category, description, tags: parseTags(tags) };
            });
            const invalid = tiles.find(tile => !tile.title.trim() || !tile.category.trim() || tile.tags.length > 12 || tile.tags.some(tag => tag.length > 32));
            if (invalid) throw new Error('Check the name, category, and tags for ' + (invalid.title || invalid.url) + '.');
            const result = await api<{ imported: number; skipped: number; updated?: number }>('admin/backup/import', 'POST', { version: 1, tiles, revision: preview.revision, updateUrls: tiles.filter(item => preview.existing?.some(saved => saved.url === item.url)).map(item => item.url) });
            setPreview(undefined);
            setSelection([]);
            setStatus(`Imported ${result.imported} tiles. Updated ${result.updated ?? 0} existing services. Skipped ${result.skipped - (result.updated ?? 0)} duplicates.`);
            await onImport();
            setSystem(await api<SystemInfo>('admin/system'));
          });
        }}>
        <div className="result-list">{preview.tiles.filter(item => [item.title, edits[item.url].title, item.url, item.category, edits[item.url].category, item.source ?? ''].join(' ').toLowerCase().includes(filter.toLowerCase())).map(item => <div className="review-item" key={item.url}><label className="import-row">
          <input type="checkbox" aria-label={"Select " + (edits[item.url].title || item.url)} checked={selection.includes(item.url)} disabled={busy} onChange={event => {
            setSelection(event.target.checked ? [...selection, item.url] : selection.filter(url => url !== item.url));
          }} /><span><strong>{edits[item.url].title || item.title}</strong> <small>{preview.existing?.some(saved => saved.url === item.url) ? 'Update existing' : 'New tile'}</small> <small className="muted">{edits[item.url].category}</small><br /><span className="muted">{item.url}</span>{item.source && <><br /><small className="muted">{item.source}</small></>}{item.description && <><br /><small className="muted">{item.description}</small></>}</span>
        </label>
          {selection.includes(item.url) && <details className="review-edit"><summary>Edit details</summary>
            <div className="review-fields">
              <label>Name<input value={edits[item.url].title} disabled={busy} maxLength={80} autoComplete="off" onChange={event => setEdits(previous => ({ ...previous, [item.url]: { ...previous[item.url], title: event.target.value } }))} /></label>
              <ImportCategory categories={categories} value={edits[item.url].category} disabled={busy} onChange={category => setEdits(previous => ({ ...previous, [item.url]: { ...previous[item.url], category } }))} />
              <label>Tags (comma separated)<input value={edits[item.url].tags} disabled={busy} maxLength={420} autoComplete="off" onChange={event => setEdits(previous => ({ ...previous, [item.url]: { ...previous[item.url], tags: event.target.value } }))} /></label>
              <label>Description<textarea value={edits[item.url].description} disabled={busy} maxLength={180} rows={2} onChange={event => setEdits(previous => ({ ...previous, [item.url]: { ...previous[item.url], description: event.target.value } }))} /></label>
            </div>
          </details>}
        </div>)}</div>
        <p className="muted">{selection.length} selected across all results, including results hidden by the filter.</p>
        <button className="primary" disabled={busy || !selection.length}>{busy ? 'Importing…' : `Apply selected (${selection.length})`}</button>
        </form>
      </>}
    </section>}
  </div>;
}
