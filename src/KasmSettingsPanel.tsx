import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { kasmPermissions, type KasmLaunch, type KasmSettings } from '../server/kasm-types.js';
import { ServiceDialog } from './ServiceDialog.js';

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;
export type KasmTestTile = { id: number; title: string; url: string };
const endpoint = 'admin/kasm';

export function KasmSettingsPanel({ api, tiles, onSave }: {
  api: Api;
  tiles: KasmTestTile[];
  onSave: () => Promise<void>;
}) {
  const [saved, setSaved] = useState<KasmSettings>();
  const [draft, setDraft] = useState<KasmSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState('');
  const [test, setTest] = useState<KasmTestTile>();
  const testId = test?.id;
  const launch = useCallback(() => api<KasmLaunch>('admin/remote-browser/' + testId), [api, testId]);

  useEffect(() => {
    let active = true;
    void api<KasmSettings>(endpoint).then(settings => {
      if (active) { setSaved(settings); setDraft(settings); }
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api]);

  async function save(input: object) {
    setBusy(true); setError(''); setNotice('');
    try {
      const settings = await api<KasmSettings>(endpoint, 'PUT', input);
      setSaved(settings); setDraft(settings);
      setNotice('Kasm settings saved.');
      await onSave();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save Kasm settings.'); }
    finally { setBusy(false); }
  }

  const tile = tiles.find(item => String(item.id) === selected);
  const dirty = draft !== saved;
  return <section className="tile admin-panel kasm-settings">
    <h2>Kasm Workspaces</h2>
    <p className="muted">Open services in a remote browser inside StackJetty. Sign in with your Kasm account when prompted.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!draft || !saved ? (!error && <p role="status">Loading Kasm settings…</p>) : <>
      <form onSubmit={event => {
        event.preventDefault();
        const { url, enabled, permissions } = draft;
        void save({ url, enabled, permissions });
      }}>
        <div className="admin-detail-grid">
          <section className="admin-inset">
            <h3>Connection</h3>
            <p className="muted admin-help">{saved.enabled ? 'Enabled' : 'Disabled'} · {saved.source === 'dashboard' ? 'Saved here' : saved.source === 'environment' ? 'Server configuration' : 'Default settings'}</p>
            <label>Kasm HTTPS address
              <input type="url" placeholder="https://browser.example.net/" maxLength={2048}
                value={draft.url} required={draft.enabled} disabled={busy} aria-describedby="kasm-url-help"
                onChange={event => setDraft({ ...draft, url: event.target.value })} />
            </label>
            <small id="kasm-url-help" className="muted">Use the address your browser can reach, including the port if needed.</small>
            <label className="consent"><input type="checkbox" checked={draft.enabled} disabled={busy}
              onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /> Enable Kasm for StackJetty administrators</label>
          </section>
          <fieldset className="admin-inset" disabled={busy}>
            <legend>Browser permissions</legend>
            <small className="muted">These apply to embedded Kasm sessions. Your browser may still ask for permission.</small>
            {kasmPermissions.map(({ id, label }) => <label key={id} className="consent">
              <input type="checkbox" checked={draft.permissions.includes(id)} onChange={event => setDraft({
                ...draft, permissions: event.target.checked ? [...draft.permissions, id] : draft.permissions.filter(value => value !== id),
              })} /> {label}
            </label>)}
          </fieldset>
        </div>
        <div className="admin-form-actions">
          <button className="primary" disabled={busy || !dirty}>Save Kasm settings</button>
          {saved.source === 'dashboard' && saved.hasEnvironment && <button type="button" disabled={busy}
            onClick={() => void save({ useServerDefault: true })}>Use server configuration</button>}
        </div>
      </form>
      <section className="admin-inset kasm-test">
        <h3>Verify setup</h3>
        <p className="muted admin-help">In Kasm, set a default browser workspace for your account. For an embedded session, the browser must trust the Kasm certificate and allow its sign-in cookies.</p>
        {saved.url && <a className="admin-action-link" href={saved.url} target="_blank" rel="noopener noreferrer">
          Open Kasm Workspaces <ArrowUpRight size={16} aria-hidden="true" />
        </a>}
        {saved.enabled && tiles.length > 0 && <div className="admin-field-row">
          <label>Tile to test<select aria-label="Tile to test" value={selected} onChange={event => setSelected(event.target.value)}>
            <option value="">Select a saved tile</option>
            {tiles.map(item => <option key={item.id} value={item.id}>{item.title} · {item.url}</option>)}
          </select></label>
          <div><button type="button" disabled={!tile || busy || dirty} onClick={() => setTest(tile)}>Test embedded launch</button></div>
        </div>}
        {saved.enabled && tiles.length === 0 && <small className="muted">Add a tile to test an embedded launch.</small>}
      </section>
      {test && <ServiceDialog title={test.title} url={test.url} showVault startRemote launchRemote={launch} onClose={() => setTest(undefined)} />}
    </>}
  </section>;
}
