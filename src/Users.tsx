import { useEffect, useState } from 'react';
import { AccountEditor, type Account } from './AccountEditor.js';

type User = Account;
type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

export function Users({ api, currentId, onChange, onSignedOut }: {
  api: Api; currentId?: number; onChange: () => void; onSignedOut: () => Promise<void>;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [remove, setRemove] = useState<User>();
  const [shared, setShared] = useState(false);
  const [editing, setEditing] = useState<User>();
  const refresh = () => api<User[]>('admin/users').then(setUsers);
  useEffect(() => { api<User[]>('admin/users').then(setUsers).catch(error => setStatus(error.message)); }, [api]);
  async function change(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setStatus('');
    setMessage('');
    try {
      await operation();
      await refresh();
      setMessage(success);
      onChange();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="tile admin-panel">
    <h2>Users and dashboard access</h2>
    <p className="muted">Editors manage tiles. Viewers open services.</p>
    <div className="admin-detail-grid admin-user-layout">
    <section aria-label="Dashboard accounts">
    <ul className="user-list admin-records">{users.map(user => <li key={user.id}>
      <span><strong>{user.username === 'shared' ? 'Shared dashboard password' : user.username}</strong><br /><small className="muted">{user.primaryAdmin ? 'Primary administrator' : user.role === 'admin' ? 'Administrator' : user.role === 'editor' ? 'Editor' : 'Viewer'}
        {user.mustResetPassword && ' · Password change required'}</small></span>
      <div className="actions">
        {(!user.primaryAdmin || user.id === currentId) && <button aria-label={'Edit account ' + user.username} disabled={busy} onClick={() => { setEditing(user); setRemove(undefined); setMessage(''); }}>Edit</button>}
        {!user.primaryAdmin && user.id !== currentId && <button aria-label={'Remove access for ' + user.username} disabled={busy} onClick={() => setRemove(user)}>Remove access</button>}
      </div>
    </li>)}</ul>
    {remove && <div className="account-confirmation"><p>Remove access and end sessions for {remove.username}?</p>
      <button className="danger" disabled={busy} onClick={() => void change(async () => {
        await api('admin/users/' + remove.id, 'DELETE');
        setRemove(undefined);
      }, 'Access removed.')}>Confirm removal</button>{' '}
      <button disabled={busy} onClick={() => setRemove(undefined)}>Cancel</button>
    </div>}
    </section>
    {editing ? <AccountEditor key={editing.id + ':' + editing.revision} account={editing} self={editing.id === currentId} administrative api={api}
      onCancel={() => setEditing(undefined)} onSaved={async signedOut => {
        if (signedOut) { await onSignedOut(); return; }
        await refresh(); setEditing(undefined); setMessage('Account updated. Active sessions ended.'); onChange();
      }} /> : <form className="admin-inset" aria-label="Add dashboard access" onSubmit={event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      void change(async () => {
        await api('admin/users', 'POST', shared ? { username: 'shared', password: values.password, role: 'viewer' }
          : { ...values, mustResetPassword: values.mustResetPassword === 'on' });
        form.reset();
        setShared(false);
      }, shared ? 'Shared access enabled.' : 'User created.');
    }}>
      <h3>Add access</h3>
      {!users.some(user => user.username === 'shared') &&
        <label className="import-row"><span><input type="checkbox" checked={shared} onChange={event => setShared(event.target.checked)} /> Enable access with a shared dashboard password</span></label>}
      {!shared && <label>Username<input name="username" autoComplete="off" maxLength={64} required /></label>}
      <label>{shared ? 'Shared dashboard password' : 'Initial password'}<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
      {!shared && <><label>Role<select name="role"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Administrator</option></select></label>
        <label className="consent"><input name="mustResetPassword" type="checkbox" /> Require password change at next sign-in</label></>}
      <div className="admin-form-actions"><button className="primary" disabled={busy}>{shared ? 'Enable shared access' : 'Create user'}</button></div>
    </form>}
    </div>
    {message && <p role="status">{message}</p>}
    {status && <p role="alert">{status}</p>}
  </section>;
}
