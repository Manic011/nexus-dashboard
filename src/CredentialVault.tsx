import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { unlockVault, type VaultEntries } from './vault.js';

type OpenVault = Awaited<ReturnType<typeof unlockVault>>;
type Credential = VaultEntries[string];
type CredentialVault = {
  available: boolean;
  exists: boolean;
  entries: VaultEntries | undefined;
  unlock: (password: string, confirmation: string) => Promise<void>;
  lock: () => void;
  save: (address: string, credential?: Credential) => Promise<void>;
  hasLegacy: (hostId: number) => boolean;
  importLegacy: (hostId: number, address: string, username: string, password: string) => Promise<void>;
};

const Context = createContext<CredentialVault | undefined>(undefined);

export function useCredentialVault() {
  const vault = useContext(Context);
  if (!vault) throw new Error('Credential vault provider is missing.');
  return vault;
}

export function sshCredentialAddress({ host, port, username, fingerprint }: {
  host: string; port: number; username: string; fingerprint?: string;
}) {
  return 'ssh:' + JSON.stringify([host.toLowerCase(), port, username, fingerprint]);
}

export function CredentialVaultProvider({ username, children }: { username: string; children: ReactNode }) {
  // Keep the existing service vault so saved logins and its master password carry over.
  const key = 'nexus.vault.v1:' + username;
  const [storage] = useState(() => {
    if (username === 'shared' || !window.isSecureContext || !window.crypto?.subtle || !navigator.locks) return { available: false, sealed: null };
    try { return { available: true, sealed: localStorage.getItem(key) }; }
    catch { return { available: false, sealed: null }; }
  });
  const [exists, setExists] = useState(Boolean(storage.sealed));
  const [entries, setEntries] = useState<VaultEntries>();
  const current = useRef<{ sealed: string | null; vault?: OpenVault }>({ sealed: storage.sealed });
  const epoch = useRef(0);
  const timer = useRef<number>(undefined);
  const legacyKey = (hostId: number) => 'nexus.ssh.vault.v1:' + username + ':' + hostId;

  function lock() {
    window.clearTimeout(timer.current);
    epoch.current++;
    current.current.vault = undefined;
    setEntries(undefined);
  }

  function open(vault: OpenVault, sealed: string) {
    current.current = { vault, sealed };
    setExists(true);
    setEntries(vault.entries);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(lock, 120_000);
  }

  useEffect(() => {
    if (!storage.available) return;
    function onStorage(event: StorageEvent) {
      if (event.key !== key && event.key !== null) return;
      const sealed = localStorage.getItem(key);
      if (sealed === current.current.sealed) return;
      lock();
      current.current.sealed = sealed;
      setExists(Boolean(sealed));
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', lock);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', lock);
      window.clearTimeout(timer.current);
      epoch.current++;
      current.current.vault = undefined;
    };
  }, [key, storage.available]);

  function assertCurrent(generation: number, sealed: string | null) {
    if (epoch.current !== generation) throw new Error('The vault is locked. Unlock it and try again.');
    const stored = localStorage.getItem(key);
    if (stored === sealed) return;
    lock();
    current.current.sealed = stored;
    setExists(Boolean(stored));
    throw new Error('The vault changed in another tab. Unlock it again.');
  }

  async function unlock(password: string, confirmation: string) {
    const generation = epoch.current;
    const { sealed } = current.current;
    if (!sealed && password.length < 16) throw new Error('Use at least 16 characters for your master password.');
    if (!sealed && password !== confirmation) throw new Error('The master passwords must match.');
    let vault: OpenVault;
    try { vault = await unlockVault(password, sealed); }
    catch { throw new Error('Unable to unlock the vault. Check your master password.'); }
    const next = sealed ?? await vault.seal({});
    await navigator.locks.request(key, () => {
      assertCurrent(generation, sealed);
      if (!sealed) localStorage.setItem(key, next);
      open(vault, next);
    });
  }

  async function save(address: string, credential?: Credential, replace = true) {
    const generation = epoch.current;
    await navigator.locks.request(key, async () => {
      const { sealed, vault } = current.current;
      assertCurrent(generation, sealed);
      if (!vault) throw new Error('Unlock the vault first.');
      if (!replace && Object.hasOwn(vault.entries, address)) throw new Error('A password is already saved for this destination.');
      const next = { ...vault.entries };
      if (credential) next[address] = credential;
      else delete next[address];
      const envelope = await vault.seal(next);
      assertCurrent(generation, sealed);
      localStorage.setItem(key, envelope);
      open({ ...vault, entries: next }, envelope);
    });
  }

  async function importLegacy(hostId: number, address: string, username: string, password: string) {
    const legacy = legacyKey(hostId);
    const generation = epoch.current;
    await navigator.locks.request(legacy, async () => {
      const sealed = localStorage.getItem(legacy);
      if (!sealed) throw new Error('The old machine vault is unavailable.');
      let vault: OpenVault;
      try { vault = await unlockVault(password, sealed); }
      catch { throw new Error('The old machine vault could not be unlocked. Check its previous master password.'); }
      const credential = vault.entries[address];
      if (!credential || credential.username !== username) throw new Error('The old vault has no password for this machine and trusted key.');
      if (generation !== epoch.current) throw new Error('The vault is locked. Unlock it and try again.');
      await save(address, credential, false);
      localStorage.removeItem(legacy);
    });
  }

  function hasLegacy(hostId: number) {
    try { return storage.available && Boolean(localStorage.getItem(legacyKey(hostId))); }
    catch { return false; }
  }

  return <Context.Provider value={{ available: storage.available, exists, entries, unlock, lock, save, hasLegacy, importLegacy }}>{children}</Context.Provider>;
}
