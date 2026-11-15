import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { unlockVault } from './vault.js';

type ServiceDialogProps = {
  title: string;
  url: string;
  username?: string;
  startRemote: boolean;
  launchRemote?: () => Promise<{ url: string }>;
  onClose: () => void;
};

export function ServiceDialog({ title, url, username, startRemote, launchRemote, onClose }: ServiceDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const address = new URL(url);
  const [remote, setRemote] = useState<string>();
  const [remoteSelected, setRemoteSelected] = useState(startRemote);
  const [remoteError, setRemoteError] = useState('');

  useEffect(() => {
    if (!remoteSelected || !launchRemote) return;
    let active = true;
    launchRemote().then(({ url }) => {
      const workspace = new URL(url);
      if (workspace.protocol !== 'https:' || workspace.origin === location.origin) {
        throw new Error('Remote browser requires a separate HTTPS origin.');
      }
      if (active) setRemote(workspace.href);
    }).catch(error => {
      if (active) setRemoteError(error instanceof Error ? error.message : 'Unable to open the remote browser.');
    });
    return () => { active = false; };
  }, [remoteSelected, launchRemote]);

  function selectView(useRemote: boolean) {
    setRemote(undefined);
    setRemoteError('');
    setRemoteSelected(useRemote);
  }
  const canEmbed = address.origin !== location.origin &&
    (address.protocol === 'https:' || location.protocol === 'http:');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function close() {
    dialog.current?.close();
    onClose();
  }
  return <dialog className="service-dialog" ref={dialog} aria-labelledby="service-title"
    onCancel={event => { event.preventDefault(); close(); }}>
    <div className="dialog-head">
      <h2 id="service-title">{title}</h2>
      <button aria-label="Close service view" onClick={close} autoFocus><X size={19} /></button>
    </div>
    <p className="muted service-address">{address.origin}</p>
    {username && <CredentialPanel username={username} address={address.href} />}
    {(launchRemote || remoteSelected) && <div className="service-actions">
      {remoteSelected ? <button type="button" onClick={() => selectView(false)}>Return to direct view</button>
        : <button type="button" onClick={() => selectView(true)}>Open in remote browser</button>}
    </div>}
    {remoteSelected ? (
      remote ? <iframe title={title + ' remote browser'} src={remote}
        sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" />
        : remoteError ? <p role="alert">{remoteError}</p>
        : <p role="status">{launchRemote ? 'Opening remote browser…' : 'Kasm is unavailable. It requires a configured provider and a Nexus administrator account.'}</p>
    )    : canEmbed ? <>
      <iframe title={title + ' embedded service'} src={address.href}
        sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" />
      <details className="service-help">
        <summary>Page not displaying?</summary>
        <p className="muted">The service must allow Nexus to embed it. Check the saved URL, certificate trust, and the service’s embedding settings. Some sign-in flows also require cookies that your browser may restrict in embedded pages.</p>
      </details>
    </> : <p role="status">{address.origin === location.origin
      ? 'Choose a service URL on a different origin to open it here.'
      : 'Use an HTTPS service URL to open it inside this HTTPS dashboard.'}</p>}
  </dialog>;
}

function CredentialPanel({ username, address }: { username: string; address: string }) {
  const [open, setOpen] = useState(false);
  return <details className="credential-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Saved login</summary>
    {open && (!window.isSecureContext
      ? <p className="muted">Open Nexus over HTTPS to use the credential vault.</p>
      : window.crypto?.subtle && navigator.locks
        ? <VaultForm username={username} address={address} />
        : <p className="muted">Use a current browser with Web Crypto and Web Locks to open the vault.</p>)}
  </details>;
}

function VaultForm({ username, address }: { username: string; address: string }) {
  const key = 'nexus.vault.v1:' + username;
  const [sealed, setSealed] = useState(() => localStorage.getItem(key));
  const [vault, setVault] = useState<Awaited<ReturnType<typeof unlockVault>>>();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const saved = vault?.entries[address];
  useEffect(() => {
    if (!vault) return;
    const lock = () => { setVault(undefined); setStatus('Vault locked.'); };
    const timer = window.setTimeout(lock, 120_000);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) {
        setSealed(localStorage.getItem(key));
        lock();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => { window.clearTimeout(timer); window.removeEventListener('storage', onStorage); };
  }, [key, vault]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try { await work(); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'The vault operation failed.'); }
    finally { setBusy(false); }
  }

  function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = event.currentTarget;
    const values = new FormData(fields);
    const master = String(values.get('master'));
    if (!sealed && master !== values.get('confirm')) {
      setStatus('The master passwords must match.');
      return;
    }
    fields.reset();
    void run(async () => {
      let opened;
      try { opened = await unlockVault(master, sealed); }
      catch { throw new Error('Unable to unlock the vault. Check your master password.'); }
      if (!sealed) await write(await opened.seal({}));
      setVault(opened);
    });
  }

  async function write(value: string) {
    await navigator.locks.request(key, () => {
      const current = localStorage.getItem(key);
      if (current !== sealed) {
        setVault(undefined);
        setSealed(current);
        throw new Error('The vault changed in another tab. Unlock it again.');
      }
      localStorage.setItem(key, value);
      setSealed(value);
    });
  }

  async function save(next?: { username: string; password: string }) {
    if (!vault) return;
    const entries = { ...vault.entries };
    if (next) entries[address] = next;
    else delete entries[address];
    const envelope = await vault.seal(entries);
    await write(envelope);
    setVault(current => current && { ...current, entries });
    setStatus(next ? 'Login saved.' : 'Login removed.');
  }

  return <>
    {vault ? <form className="vault-form" key={address + String(!!saved)} onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void run(() => save({ username: String(data.get('username')), password: String(data.get('password')) }));
    }} autoComplete="off">
      <label>Service username<input name="username" defaultValue={saved?.username} maxLength={512} disabled={busy} /></label>
      <label>Service password<input name="password" type="password" defaultValue={saved?.password} maxLength={2048} required disabled={busy} /></label>
      <div className="service-actions">
        <button type="submit" disabled={busy}>Save login</button>
        {saved && <>
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            await navigator.clipboard.writeText(saved.username); setStatus('Username copied.');
          })}>Copy username</button>
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            await navigator.clipboard.writeText(saved.password); setStatus('Password copied.');
          })}>Copy password</button>
          <button type="button" disabled={busy} onClick={() => void run(() => save())}>Remove login</button>
        </>}
        <button type="button" disabled={busy} onClick={() => { setVault(undefined); setStatus('Vault locked.'); }}>Lock vault</button>
      </div>
    </form> : <form className="vault-form" onSubmit={unlock} autoComplete="off">
      {!sealed && <p className="muted">Use a unique master password. This vault lives in this browser. Clearing site data removes it.</p>}
      <label>Master password<input name="master" type="password" autoComplete={sealed ? 'current-password' : 'new-password'} required minLength={sealed ? undefined : 16} maxLength={256} /></label>
      {!sealed && <label>Confirm master password<input name="confirm" type="password" autoComplete="new-password" required minLength={16} maxLength={256} /></label>}
      <div className="service-actions"><button disabled={busy}>{sealed ? 'Unlock vault' : 'Create vault'}</button></div>
    </form>}
    {status && <p role="status">{status}</p>}
  </>;
}
