type Credential = { username: string; password: string };
export type VaultEntries = Record<string, Credential>;
type Envelope = { version: 1; salt: string; iv: string; ciphertext: string };

const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, value => String.fromCharCode(value)).join(''));
const decode = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const encoder = new TextEncoder();
const additionalData = encoder.encode('Nexus credential vault v1');

async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  const input = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    input, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function unlockVault(password: string, sealed: string | null) {
  const envelope: Envelope | null = sealed ? JSON.parse(sealed) : null;
  if (envelope && envelope.version !== 1) throw new Error('Unsupported vault version.');
  const salt = envelope ? decode(envelope.salt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(password, salt);
  const entries: VaultEntries = envelope
    ? JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(envelope.iv), additionalData }, key, decode(envelope.ciphertext),
    )))
    : {};
  return {
    entries,
    async seal(next: VaultEntries) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, encoder.encode(JSON.stringify(next)));
      return JSON.stringify({ version: 1, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) } satisfies Envelope);
    },
  };
}
