import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { describeService, homelabPorts, httpsPorts } from './homelab-catalog.ts';

export function webScope(address: string, prefix: number) {
  const bits = Math.max(prefix, 24);
  const ip = address.split('.').reduce((result, octet) => result * 256 + Number(octet), 0);
  const size = 2 ** (32 - bits);
  const base = Math.floor(ip / size) * size;
  const format = (value: number) => [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.');
  return {
    cidr: format(base) + '/' + bits,
    hosts: Array.from({ length: size > 2 ? size - 2 : size }, (_, index) => format(base + index + (size > 2 ? 1 : 0))),
  };
}

const certificateErrors = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED',
]);

function identify(host: string, port: number, localAddress: string, secure: boolean) {
  return new Promise<{ title: string; certificateIssue: boolean } | undefined>(resolve => {
    const request = (secure ? httpsRequest : httpRequest)({
      host, port, localAddress, method: 'GET', path: '/', agent: false,
      maxHeaderSize: 8192, headers: { Accept: 'text/html' },
    }, response => {
      const finish = (title = '') => {
        resolve({ title, certificateIssue: false });
        response.destroy();
      };
      if (!response.headers['content-type']?.toLowerCase().includes('text/html')) return finish();
      let html = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        html += String(chunk).slice(0, 16384 - html.length);
        const title = /<title(?:\s[^>]*)?>\s*([^<]{1,160})\s*<\/title\s*>/i.exec(html)?.[1]?.trim();
        if (title || html.length >= 16384) finish(title);
      });
      response.on('end', () => finish());
      response.on('error', () => finish());
      response.on('close', () => finish());
    });
    const timeout = setTimeout(() => request.destroy(), 500);
    request.once('error', (error: NodeJS.ErrnoException) => resolve(secure && certificateErrors.has(error.code ?? '')
      ? { title: '', certificateIssue: true } : undefined));
    request.once('close', () => { clearTimeout(timeout); resolve(undefined); });
    request.end();
  });
}

export async function discoverWebServices(address: string, prefix: number) {
  const { hosts } = webScope(address, prefix);
  const targets = homelabPorts.flatMap(port => hosts.map(host => ({ host, port })));
  const services: { title: string; url: string; category: string; description: string }[] = [];
  let next = 0;
  const deadline = Date.now() + 90_000;
  await Promise.all(Array.from({ length: 48 }, async () => {
    while (next < targets.length && Date.now() < deadline) {
      const { host, port } = targets[next++];
      const secure = httpsPorts.has(port);
      const result = await identify(host, port, address, secure);
      if (result) {
        const url = new URL(`${secure ? 'https' : 'http'}://${host}:${port}/`).href;
        services.push({ ...describeService(host, port, result.title, result.certificateIssue), url });
      }
    }
  }));
  return { services, checked: next, total: targets.length };
}
