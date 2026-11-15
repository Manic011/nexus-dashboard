import { useRef, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { useCredentialVault } from './CredentialVault.js';
import type { VaultEntries } from './vault.js';

type Credential = VaultEntries[string];

function useVaultAction() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  async function run(work: () => Promise<void>, success = '') {
    setBusy(true);
    setStatus('');
    try { await work(); setStatus(success); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'The vault operation failed.'); }
    finally { setBusy(false); }
  }
  return { busy, status, run, setStatus };
}

function VaultUnlock() {
  const vault = useCredentialVault();
  const { busy, status, run } = useVaultAction();
  if (!vault.available) return <p className="muted">The vault needs an individual account, HTTPS or localhost, and a browser that allows site storage, Web Crypto, and Web Locks.</p>;
  return <form className="vault-form" onSubmit={event => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    form.reset();
    void run(() => vault.unlock(String(data.get('master')), String(data.get('confirm') ?? '')));
  }} autoComplete="off">
    {!vault.exists && <p className="muted">Create one master password for your service logins and SSH passwords on this dashboard address.</p>}
    <label>Master password<input name="master" type="password" autoComplete={vault.exists ? 'current-password' : 'new-password'}
      required minLength={vault.exists ? undefined : 16} maxLength={256} disabled={busy} /></label>
    {!vault.exists && <label>Confirm master password<input name="confirm" type="password" autoComplete="new-password"
      required minLength={16} maxLength={256} disabled={busy} /></label>}
    <div className="service-actions"><button disabled={busy}>{vault.exists ? 'Unlock vault' : 'Create vault'}</button></div>
    {status && <p role="status">{status}</p>}
  </form>;
}

export function VaultEditor({ address, machine, onUse }: {
  address: string; machine?: { id: number; username: string }; onUse?: (credential: Credential) => Promise<void>;
}) {
  const vault = useCredentialVault();
  const { busy, status, run, setStatus } = useVaultAction();
  const saved = vault.entries?.[address];
  if (!vault.entries) return <VaultUnlock />;
  return <>
    {machine && !saved && vault.hasLegacy(machine.id) && <form className="vault-form" onSubmit={event => {
      event.preventDefault();
      const form = event.currentTarget;
      const password = String(new FormData(form).get('legacy'));
      form.reset();
      void run(() => vault.importLegacy(machine.id, address, machine.username, password), 'SSH password imported.');
    }}>
      <p className="muted">This machine has a saved password in its old vault. Import it once to use it here.</p>
      <label>Previous machine vault password<input type="password" name="legacy" autoComplete="off" maxLength={256} required disabled={busy} /></label>
      <button disabled={busy}>Import previous password</button>
    </form>}
    <form className="vault-form" key={address + String(!!saved)} onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void run(() => vault.save(address, { username: machine?.username ?? String(data.get('username')), password: String(data.get('password')) }),
        machine ? 'SSH password saved.' : 'Login saved.');
    }} autoComplete="off">
      <label>{machine ? 'Saved SSH username' : 'Service username'}<input name="username" defaultValue={machine?.username ?? saved?.username}
        readOnly={!!machine} maxLength={512} disabled={busy} /></label>
      <label>{machine ? 'SSH password to save' : 'Service password'}<input name="password" type="password"
        defaultValue={saved?.password} maxLength={machine ? 4096 : 2048} required disabled={busy} /></label>
      <div className="service-actions">
        <button type="submit" disabled={busy}>{machine ? 'Save SSH password' : 'Save login'}</button>
        {saved && onUse && <button type="button" disabled={busy} onClick={() => void run(() => onUse(saved))}>Connect with saved password</button>}
        {saved && <>
          {!machine && <>
            <button type="button" disabled={busy} onClick={() => void run(() => navigator.clipboard.writeText(saved.username), 'Username copied.')}>Copy username</button>
            <button type="button" disabled={busy} onClick={() => void run(() => navigator.clipboard.writeText(saved.password), 'Password copied.')}>Copy password</button>
          </>}
          <button type="button" disabled={busy} onClick={() => void run(() => vault.save(address), machine ? 'SSH password removed.' : 'Login removed.')}>
            {machine ? 'Remove saved password' : 'Remove login'}
          </button>
        </>}
        <button type="button" onClick={() => { vault.lock(); setStatus(''); }}>Lock vault</button>
      </div>
    </form>
    {status && <p role="status">{status}</p>}
  </>;
}

function credentialLabel(address: string) {
  if (!address.startsWith('ssh:')) return address;
  try {
    const [host, port, username] = JSON.parse(address.slice(4));
    return 'SSH · ' + username + '@' + (host.includes(':') ? '[' + host + ']' : host) + ':' + port;
  } catch { return 'SSH credential'; }
}

function VaultContents() {
  const vault = useCredentialVault();
  const [removing, setRemoving] = useState<string>();
  const { busy, status, run } = useVaultAction();
  if (!vault.entries) return <VaultUnlock />;
  const addresses = Object.keys(vault.entries).sort();
  return <>
    <p className="muted">Unlocked for this account in this browser tab.</p>
    <button type="button" onClick={() => { setRemoving(undefined); vault.lock(); }}>Lock vault</button>
    {addresses.length ? <ul className="user-list">{addresses.map(address => <li key={address}>
      <span className="service-address">{credentialLabel(address)}</span>
      {removing === address ? <div className="actions">
        <button type="button" disabled={busy} onClick={() => void run(async () => { await vault.save(address); setRemoving(undefined); }, 'Credential removed.')}>Confirm removal</button>
        <button type="button" disabled={busy} onClick={() => setRemoving(undefined)}>Cancel removal</button>
      </div> : <button type="button" disabled={busy} onClick={() => setRemoving(address)}>Remove</button>}
    </li>)}</ul> : <p className="muted">Save passwords from a service’s Saved login panel or from SSH machines.</p>}
    {status && <p role="status">{status}</p>}
  </>;
}

export function VaultMenu() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-haspopup="dialog" onClick={() => { dialog.current?.showModal(); setOpen(true); }}>
      <KeyRound size={16} aria-hidden="true" /> Vault
    </button>
    <dialog ref={dialog} aria-labelledby="credential-vault-title" onClose={() => setOpen(false)}>
      <div className="dialog-head">
        <h2 id="credential-vault-title">Credential vault</h2>
        <button type="button" aria-label="Close credential vault" onClick={() => dialog.current?.close()}><X size={18} /></button>
      </div>
      {open && <VaultContents />}
    </dialog>
  </>;
}
