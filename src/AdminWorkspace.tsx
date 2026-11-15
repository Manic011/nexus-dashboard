import { useEffect, useState } from 'react';

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;
type RecordInfo = { id: number; label: string; created: string };
type Group = { id: number; name: string; users: number[] };
type Policy = { restricted: boolean; users: number[]; groups: number[] };
type Catalog = {
  groups: Group[];
  tiles: { id: number; title: string; url: string; category: string; access: Policy }[];
  scans: RecordInfo[];
  backups: RecordInfo[];
};
type Choice = { id: number; name: string; role?: string };
type RestorePreview = { tiles: number; groups: number; revision: string; changes: { kind: string; added: string[]; removed: string[]; changed: string[] }[] };

function Choices({ items, selected, change }: { items: Choice[]; selected: number[]; change: (ids: number[]) => void }) {
  return <div className="account-choices">{items.map(item => <label key={item.id}>
    <input type="checkbox" checked={selected.includes(item.id)} onChange={event => change(event.target.checked
      ? [...selected, item.id] : selected.filter(id => id !== item.id))} /> {item.name}
  </label>)}</div>;
}

export function AdminWorkspace({ section, api, refresh, inspect }: {
  section: 'users' | 'backup' | 'discovery' | 'system';
  api: Api;
  refresh: () => Promise<void>;
  inspect: (input: object) => Promise<void>;
}) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [accounts, setAccounts] = useState<Choice[]>([]);
  const [groupId, setGroupId] = useState(0);
  const [confirmGroupRemoval, setConfirmGroupRemoval] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [members, setMembers] = useState<number[]>([]);
  const [tileId, setTileId] = useState(0);
  const [policy, setPolicy] = useState<Policy>({ restricted: false, users: [], groups: [] });
  const [target, setTarget] = useState<RestorePreview & { record: RecordInfo }>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const [data, users] = await Promise.all([
      api<Catalog>('admin/console'), api<{ id: number; username: string; role: string }[]>('admin/users'),
    ]);
    setCatalog(data);
    setAccounts(users.map(user => ({ id: user.id, name: user.username, role: user.role })));
  }

  useEffect(() => { void load().catch(err => setError(err.message)); }, [api]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : 'Request failed.'); }
    finally { setBusy(false); }
  }

  const grantable = accounts.filter(account => account.role !== 'admin');
  const feedback = <>{error && <p role="alert" className="error">{error}</p>}{message && <p role="status">{message}</p>}</>;
  if (!catalog) return <div aria-busy={!error}>{feedback}{!error && <p role="status" className="muted">Loading administration…</p>}</div>;
  const date = (value: string) => new Date(value).toLocaleString();
  return <div className="admin-workspace" data-section={section}>
    {section === 'discovery' && <section className="tile admin-panel">
      <h2>Discovery history</h2><p className="muted">Reopen a scan to edit and import services.</p>
      {!catalog.scans.length && <p>No completed scans yet.</p>}
      <ul className="user-list admin-records">{catalog.scans.map(scan => <li key={scan.id}>
        <span><strong>{scan.label}</strong><br /><small className="muted">{date(scan.created)}</small></span>
        <button disabled={busy} onClick={() => void run(async () => inspect(await api<object>('admin/scans/' + scan.id)))}>Review results</button>
      </li>)}</ul>
    </section>}
    {section === 'backup' && <section className="tile admin-panel">
      <h2>Saved configurations</h2>
      <p className="muted">Snapshots save tiles, groups, and tile permissions. Accounts and server settings are managed separately.</p>
      <form className="admin-inline-form" onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const name = new FormData(form).get('name');
        void run(async () => { await api('admin/snapshots', 'POST', { name }); await load(); form.reset(); setMessage('Snapshot saved.'); });
      }}>
        <label>Snapshot name<input name="name" required maxLength={80} placeholder="Before changing tile access" /></label>
        <button className="primary" disabled={busy}>Save snapshot</button>
      </form>
      {!catalog.backups.length && <p>No saved configurations yet.</p>}
      <ul className="user-list admin-records">{catalog.backups.map(record => <li key={record.id}>
        <span><strong>{record.label}</strong><br /><small className="muted">{date(record.created)}</small></span>
        <button disabled={busy} onClick={() => void run(async () => {
          const info = await api<RestorePreview>('admin/snapshots/' + record.id);
          setTarget({ ...info, record });
        })}>Review restore</button>
      </li>)}</ul>
      {target && <div className="account-confirmation">
        <p>Replace the current configuration with {target.record.label} ({target.tiles} tiles and {target.groups} groups)? StackJetty saves the current configuration first.</p>
        <ul className="restore-diff">{target.changes.map(change => <li key={change.kind}><strong>{change.kind}</strong>
          <ul>{(['added', 'removed', 'changed'] as const).map(action => <li key={action}>
            {action[0].toUpperCase() + action.slice(1)} · {change[action].length ? change[action].join(', ') : 'None'}
          </li>)}</ul>
        </li>)}</ul>
        <button disabled={busy} onClick={() => setTarget(undefined)}>Cancel</button>
        <button className="danger" disabled={busy} onClick={() => void run(async () => {
          await api('admin/snapshots/' + target.record.id, 'POST', { revision: target.revision });
          setTarget(undefined);
          await Promise.all([load(), refresh()]);
          setMessage('Configuration restored. The previous configuration is available in the list.');
        })}>Restore configuration</button>
      </div>}
    </section>}
    {section === 'users' && <>
      <section className="tile admin-panel">
      <h2>User groups</h2>
      <p className="muted">Manage membership and reuse groups in tile permissions.</p>
      <form onSubmit={event => {
        event.preventDefault();
        void run(async () => {
          await api(groupId ? 'admin/groups/' + groupId : 'admin/groups', groupId ? 'PUT' : 'POST', { name: groupName, users: members });
          setGroupId(0); setGroupName(''); setMembers([]);
          await load();
          setMessage('Group saved.');
        });
      }}>
        <div className="admin-field-row">
        <label>Group to edit<select aria-label="Group to edit" disabled={busy} value={groupId} onChange={event => {
          const group = catalog.groups.find(item => item.id === Number(event.target.value));
          setConfirmGroupRemoval(false); setGroupId(group?.id ?? 0); setGroupName(group?.name ?? ''); setMembers(group?.users ?? []);
        }}><option value={0}>New group</option>{catalog.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>Group name<input required maxLength={64} value={groupName} onChange={event => setGroupName(event.target.value)} /></label>
        </div>
        <fieldset disabled={busy}><legend>Members</legend>{grantable.length
          ? <Choices items={grantable} selected={members} change={setMembers} /> : <p className="muted">Add an editor or viewer to assign group members.</p>}</fieldset>
        <div className="admin-form-actions">
          <button className="primary" disabled={busy}>Save group</button>
          {!!groupId && <button type="button" disabled={busy} onClick={() => setConfirmGroupRemoval(true)}>Remove group</button>}
        </div>
        {confirmGroupRemoval && <div className="account-confirmation">
          <p>Remove this group and the tile access it grants?</p>
          <button type="button" disabled={busy} onClick={() => setConfirmGroupRemoval(false)}>Cancel</button>
          <button type="button" className="danger" disabled={busy} onClick={() => void run(async () => {
            await api('admin/groups/' + groupId, 'DELETE');
            setGroupId(0); setGroupName(''); setMembers([]); setConfirmGroupRemoval(false);
            await load();
            setMessage('Group removed.');
          })}>Confirm group removal</button>
        </div>}
      </form>
      </section>
      <section className="tile admin-panel">
      <h2>Tile permissions</h2>
      <p className="muted">Grant access to everyone or selected users and groups. Administrators retain access.</p>
      <form onSubmit={event => {
        event.preventDefault();
        void run(async () => { await api('admin/tile-access/' + tileId, 'PUT', policy); await load(); setMessage('Tile permissions saved.'); });
      }}>
        <label>Tile<select aria-label="Tile" disabled={busy} value={tileId} onChange={event => {
          const tile = catalog.tiles.find(item => item.id === Number(event.target.value));
          setTileId(tile?.id ?? 0);
          setPolicy(tile?.access ?? { restricted: false, users: [], groups: [] });
        }}><option value={0}>Choose a tile</option>{catalog.tiles.map(tile => <option key={tile.id} value={tile.id}>{tile.title} · {tile.url}</option>)}</select></label>
        {!!tileId && <>
          <label className="consent"><input type="checkbox" checked={policy.restricted} onChange={event => setPolicy({ ...policy, restricted: event.target.checked })} /> Restrict access</label>
          {policy.restricted && <>
            <fieldset disabled={busy}><legend>Allowed users</legend>{grantable.length ? <Choices items={grantable} selected={policy.users} change={users => setPolicy({ ...policy, users })} /> : <p className="muted">Add an editor or viewer to grant individual access.</p>}</fieldset>
            <fieldset disabled={busy}><legend>Allowed groups</legend>{catalog.groups.length ? <Choices items={catalog.groups} selected={policy.groups} change={groups => setPolicy({ ...policy, groups })} /> : <p className="muted">Create a group to grant access by membership.</p>}</fieldset>
          </>}
          <details><summary>Preview effective access</summary>
            <ul className="user-list admin-records">{accounts.map(account => {
              const groups = catalog.groups.filter(group => policy.groups.includes(group.id) && group.users.includes(account.id));
              const reasons = account.role === 'admin' ? ['Administrator'] : !policy.restricted ? ['All dashboard users']
                : [...(policy.users.includes(account.id) ? ['Individual grant'] : []), ...groups.map(group => 'Group: ' + group.name)];
              const access = !reasons.length ? 'No access' : account.role === 'viewer' ? 'View' : 'View and edit';
              return <li key={account.id}><strong>{account.name}</strong><span>{access}{reasons.length ? ' · ' + reasons.join(', ') : ''}</span></li>;
            })}</ul>
          </details>
          <div className="admin-form-actions"><button className="primary" disabled={busy}>Save permissions</button></div>
        </>}
      </form>
      </section>
    </>}
    {section === 'system' && <section className="tile admin-panel">
      <h2>Tile inventory</h2>
      <p className="muted">Configured services and who can see them in StackJetty.</p>
      <ul className="user-list admin-records admin-inventory">{catalog.tiles.map(tile => <li key={tile.id}>
        <span><strong>{tile.title}</strong><br /><small>{tile.url}</small></span>
        <small className="muted">{tile.category} · {tile.access.restricted ? 'Restricted' : 'All dashboard users'}</small>
      </li>)}</ul>
      {!catalog.tiles.length && <p>No services configured.</p>}
    </section>}
    {(error || message) && <div className="admin-feedback">{feedback}</div>}
  </div>;
}
