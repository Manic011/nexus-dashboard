import { once } from 'node:events';
import { createServer } from 'node:https';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.ts';
import { createTlsFixture } from './tls-fixture.ts';

const directory = mkdtempSync(join(tmpdir(), 'stackjetty-certificate-preview-'));
const endpoint = createServer(createTlsFixture(directory), (_req, res) => { res.writeHead(401); res.end(); });
endpoint.listen(0, '127.0.0.1'); await once(endpoint, 'listening');
const address = endpoint.address();
if (!address || typeof address === 'string') throw new Error('TLS fixture unavailable.');
const app = createApp(join(directory, 'state'), 'dist', 'http://127.0.0.1:3441', 'fixture-token');
app.listen(3441, '127.0.0.1'); await once(app, 'listening');
console.log(JSON.stringify({ port: 3441, tlsPort: address.port }));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  app.close(); app.closeAllConnections(); endpoint.close(); endpoint.closeAllConnections();
});
