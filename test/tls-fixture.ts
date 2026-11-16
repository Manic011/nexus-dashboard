import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// These disposable certificates and keys are generated in test state, never shipped.
export function createTlsFixture(directory: string) {
  const key = join(directory, 'fixture.key');
  const certificate = join(directory, 'fixture.crt');
  const rotated = join(directory, 'rotated.crt');
  let executable = process.env.OPENSSL_PATH ?? 'openssl';
  const options = { stdio: 'ignore' as const };
  const identity = ['-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-days', '2'];
  const create = ['req', '-new', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate, '-set_serial', '1', ...identity];
  try { execFileSync(executable, create, options); }
  catch (error) {
    if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'ENOENT' || process.env.OPENSSL_PATH) throw error;
    executable = 'C:/Program Files/Git/mingw64/bin/openssl.exe';
    execFileSync(executable, create, options);
  }
  execFileSync(executable, ['req', '-new', '-x509', '-key', key, '-out', rotated, '-set_serial', '2', ...identity], options);
  return { key: readFileSync(key), cert: readFileSync(certificate), rotated: readFileSync(rotated) };
}
