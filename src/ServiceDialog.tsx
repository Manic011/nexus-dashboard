import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { VaultEditor } from './VaultControls.js';

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
    {username && <CredentialPanel address={address.href} />}
    {(launchRemote || remoteSelected) && <div className="service-actions">
      {remoteSelected ? <button type="button" onClick={() => selectView(false)}>Return to direct view</button>
        : <button type="button" onClick={() => selectView(true)}>Open in remote browser</button>}
    </div>}
    {remoteSelected ? (
      remote ? <iframe title={title + ' remote browser'} src={remote}
        sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" />
        : remoteError ? <p role="alert">{remoteError}</p>
        : <p role="status">{launchRemote ? 'Opening remote browser…' : 'Kasm is unavailable. It requires a configured provider and a StackJetty administrator account.'}</p>
    )    : canEmbed ? <>
      <iframe title={title + ' embedded service'} src={address.href}
        sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" />
      <details className="service-help">
        <summary>Page not displaying?</summary>
        <p className="muted">The service must allow StackJetty to embed it. Check the saved URL, certificate trust, and the service’s embedding settings. Some sign-in flows also require cookies that your browser may restrict in embedded pages.</p>
      </details>
    </> : <p role="status">{address.origin === location.origin
      ? 'Choose a service URL on a different origin to open it here.'
      : 'Use an HTTPS service URL to open it inside this HTTPS dashboard.'}</p>}
  </dialog>;
}

function CredentialPanel({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  return <details className="credential-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Saved login</summary>
    {open && <VaultEditor address={address} />}
  </details>;
}
