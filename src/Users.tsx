import { useEffect, useState } from 'react';

type User = { id: number; username: string; role: 'admin' | 'editor' | 'viewer' };
type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

export function Users({ api }: { api: Api }) {
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [remove, setRemove] = useState<User>();
  const [shared, setShared] = useState(false);
  const refresh = () => api<User[]>('admin/users').then(setUsers);
  useEffect(() => { api<User[]>('admin/users').then(setUsers).catch(error => setStatus(error.message)); }, [api]);
  async function change(operation: () => Promise<unknown>) {
    setBusy(true);
    setStatus('');
    try {
      await operation();
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="tile">
    <h2>Users and dashboard access</h2>
    <p className="muted">Editors can manage tiles. Viewers can open the dashboard and its links. Linked applications enforce their own access controls.</p>
    <ul>{users.map(user => <li key={user.id}>
      {user.username === 'shared' ? 'Shared dashboard password' : user.username} ({user.role}){' '}
      {user.role !== 'admin' && <button disabled={busy} onClick={() => setRemove(user)}>Remove access</button>}
    </li>)}</ul>
    {remove && <p>Remove access and end sessions for {remove.username}?{' '}
      <button disabled={busy} onClick={() => void change(async () => {
        await api('admin/users/' + remove.id, 'DELETE');
        setRemove(undefined);
      })}>Confirm removal</button>{' '}
      <button disabled={busy} onClick={() => setRemove(undefined)}>Cancel</button>
    </p>}
    <form onSubmit={event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      void change(async () => {
        await api('admin/users', 'POST', shared ? { username: 'shared', password: values.password, role: 'viewer' } : values);
        form.reset();
        setShared(false);
      });
    }}>
      {!users.some(user => user.username === 'shared') &&
        <label className="import-row"><span><input type="checkbox" checked={shared} onChange={event => setShared(event.target.checked)} /> Enable access with a shared dashboard password</span></label>}
      {!shared && <label>Username<input name="username" maxLength={64} required /></label>}
      <label>{shared ? 'Shared dashboard password' : 'Initial password'}<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
      {!shared && <label>Role<select name="role"><option value="viewer">Viewer</option><option value="editor">Editor</option></select></label>}
      <button disabled={busy}>{shared ? 'Enable shared access' : 'Create user'}</button>
    </form>
    {status && <p role="alert">{status}</p>}
  </section>;
}
