import { Agent, request } from 'node:https';
import { isIP } from 'node:net';
import { connect, type TLSSocket } from 'node:tls';

export type MonitorCertificate = {
  url: string; fingerprint: string; subject: string; issuer: string; validFrom: string; validTo: string;
};

function connectEndpoint(url: URL, signal: AbortSignal) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const socket = connect({ host, port: Number(url.port || 443), servername: isIP(host) ? undefined : host, rejectUnauthorized: false });
  const abort = () => {
    const error = new Error('The TLS check timed out.');
    error.name = 'TimeoutError';
    socket.destroy(error);
  };
  if (signal.aborted) queueMicrotask(abort);
  else signal.addEventListener('abort', abort, { once: true });
  socket.once('close', () => signal.removeEventListener('abort', abort));
  return socket;
}

function certificate(socket: TLSSocket, url: URL): MonitorCertificate {
  const peer = socket.getPeerX509Certificate();
  if (!peer) throw new Error('The endpoint did not present a certificate.');
  return { url: url.href, fingerprint: peer.fingerprint256, subject: peer.subject, issuer: peer.issuer,
    validFrom: peer.validFrom, validTo: peer.validTo };
}

export function readMonitorCertificate(url: URL) {
  return new Promise<MonitorCertificate>((resolve, reject) => {
    const socket = connectEndpoint(url, AbortSignal.timeout(5000));
    socket.once('secureConnect', () => {
      try { resolve(certificate(socket, url)); }
      catch (error) { reject(error); }
      finally { socket.destroy(); }
    });
    socket.once('error', reject);
    socket.once('close', () => reject(new Error('The certificate connection closed.')));
  });
}

export async function probePinnedCertificate(url: URL, method: 'HEAD' | 'GET', fingerprint: string) {
  const signal = AbortSignal.timeout(5000);
  const agent = new Agent({ keepAlive: false, maxCachedSessions: 0 });
  agent.createConnection = (_options, callback) => {
    const socket = connectEndpoint(url, signal);
    let finished = false;
    function finish(error: Error | null) {
      if (finished) return;
      finished = true;
      callback?.(error, socket);
      if (error) socket.destroy();
    }
    socket.once('secureConnect', () => {
      try {
        if (certificate(socket, url).fingerprint !== fingerprint) {
          finish(new Error('The monitoring certificate changed.', { cause: { code: 'STACKJETTY_CERT_CHANGED' } }));
        } else finish(null);
      } catch (error) { finish(error instanceof Error ? error : new Error('Could not check the certificate.')); }
    });
    socket.once('error', finish);
    socket.once('close', () => finish(new Error('The TLS connection closed.')));
    // HTTP receives the socket only after its exact certificate has been checked.
    return undefined;
  };
  try {
    return await new Promise<number>((resolve, reject) => {
      const outgoing = request(url, { method, agent, signal }, response => {
        resolve(response.statusCode ?? 502);
        response.destroy();
      });
      outgoing.once('error', error => reject(signal.aborted ? new DOMException('The check timed out.', 'TimeoutError') : error));
      outgoing.end();
    });
  } finally { agent.destroy(); }
}
