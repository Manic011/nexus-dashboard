import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.ts';
import { createSshFixture } from './ssh-fixture.ts';

// Disposable integration target. The fixture SSH listener only binds to loopback.
const port = Number(process.env.NEXUS_DIAGNOSTIC_TEST_PORT ?? 3435);
process.env.NEXUS_SSH = 'on';
const fixture = createSshFixture(process.platform === 'linux');
fixture.server.listen(0, '127.0.0.1');
await once(fixture.server, 'listening');
const sshAddress = fixture.server.address();
if (!sshAddress || typeof sshAddress === 'string') throw new Error('Fixture SSH listener failed.');
const app = createApp(mkdtempSync(join(tmpdir(), 'stackjetty-diagnostic-preview-')), 'dist',
  'http://127.0.0.1:' + port, 'fixture-setup-token');
app.listen(port, '127.0.0.1');
console.log(JSON.stringify({ port, sshPort: sshAddress.port, fingerprint: fixture.fingerprint }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  app.close(); app.closeAllConnections(); fixture.server.close();
});
