import { useEffect, useState } from 'react';

export type Account = {
  id: number; username: string; role: 'admin' | 'editor' | 'viewer';
  primaryAdmin: boolean; mustResetPassword: boolean; revision: number;
};
type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

export function AccountEditor({ account, self, administrative = false, api, onSaved, onCancel }: {
  account: Account; self: boolean; administrative?: boolean; api: Api;
  onSaved: (signedOut: boolean) => Promise<void>; onCancel?: () => void;
}) {
  const [username, setUsername] = useState(account.username);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [role, setRole] = useState(account.role);
  const [mustReset, setMustReset] = useState(account.mustResetPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const forced = self && account.mustResetPassword;
  const shared = account.username === 'shared';
  return <form className="admin-inset account-editor" aria-label={self ? 'Edit your account' : 'Edit account ' + account.username}
    onSubmit={event => {
      event.preventDefault();
      if (password !== confirmation) { setError('The new passwords must match.'); return; }
      const form = event.currentTarget;
      const currentPassword = String(new FormData(form).get('currentPassword') ?? '');
      setBusy(true); setError('');
      void (async () => {
        try {
          const input = {
            username, revision: account.revision, ...(password ? { password } : {}),
            ...(self ? { currentPassword } : {}),
            ...(administrative ? { role, mustResetPassword: mustReset } : {}),
          };
          const result = await api<{ signedOut: boolean }>(administrative ? 'admin/users/' + account.id : 'account', 'PATCH', input);
          form.reset(); setPassword(''); setConfirmation('');
          await onSaved(result.signedOut);
        } catch (error) { setError(error instanceof Error ? error.message : 'Could not update this account.'); }
        finally { setBusy(false); }
      })();
    }}>
    <h3>{forced ? 'Set a new password' : self ? 'Your account' : 'Edit ' + account.username}</h3>
    <label>Username<input value={username} onChange={event => setUsername(event.target.value)} required maxLength={64}
      autoComplete="username" readOnly={forced || shared} disabled={busy} /></label>
    {administrative && !account.primaryAdmin && !shared && <label>Role<select aria-label="Account role" value={role}
      onChange={event => setRole(event.target.value as Account['role'])} disabled={busy}>
      <option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Administrator</option>
    </select></label>}
    {self && <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} disabled={busy} /></label>}
    <label>{self ? 'New password' : 'New or temporary password'}<input type="password" autoComplete="new-password" minLength={12} maxLength={256}
      required={forced} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
    <label>Confirm new password<input type="password" autoComplete="new-password" minLength={12} maxLength={256}
      required={!!password || forced} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></label>
    {administrative && !self && !shared && <label className="consent"><input type="checkbox" checked={mustReset}
      onChange={event => setMustReset(event.target.checked)} disabled={busy} /> Require password change at next sign-in</label>}
    <p className="muted admin-help">{self ? 'Saving ends your active sessions. Sign in again with your updated details.'
      : 'Changes end this user’s active sessions. Enter a new password to replace their current password.'}</p>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="admin-form-actions"><button className="primary" disabled={busy}>{busy ? 'Saving…' : forced ? 'Change password' : 'Save account'}</button>
      {onCancel && <button type="button" disabled={busy} onClick={onCancel}>Cancel edit</button>}
    </div>
  </form>;
}

export function AccountSettings({ api, onSaved }: { api: Api; onSaved: () => Promise<void> }) {
  const [account, setAccount] = useState<Account>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api<Account>('account').then(value => { if (active) setAccount(value); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api]);
  return <section className="tile admin-panel account-settings">
    {error && <p role="alert" className="error">{error}</p>}
    {account ? <AccountEditor key={account.id + ':' + account.revision} account={account} self api={api} onSaved={onSaved} />
      : !error && <p role="status">Loading your account…</p>}
  </section>;
}
