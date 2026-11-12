import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { describeService, homelabPorts, httpsPorts, pageNames } from './homelab-catalog.ts';

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

type Page = { html?: string; redirect?: string; certificateIssue?: boolean };

function readPage(url: URL, localAddress: string, timeoutMs: number) {
  return new Promise<Page | undefined>(resolve => {
    const secure = url.protocol === 'https:';
    const request = (secure ? httpsRequest : httpRequest)(url, {
      localAddress, method: 'GET', agent: false, maxHeaderSize: 8192, headers: { Accept: 'text/html' },
    }, response => {
      const finish = (page: Page) => {
        resolve(page);
        response.destroy();
      };
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        return finish({ redirect: response.headers.location });
      }
      if (!response.headers['content-type']?.toLowerCase().includes('text/html')) return finish({});
      let html = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        html += String(chunk).slice(0, 16384 - html.length);
        if (/<\/head\s*>/i.test(html) || html.length >= 16384) finish({ html });
      });
      response.on('end', () => finish({ html }));
      response.on('error', () => finish({}));
      response.on('close', () => finish({}));
    });
    const timeout = setTimeout(() => request.destroy(), timeoutMs);
    request.once('error', (error: NodeJS.ErrnoException) => resolve(secure && certificateErrors.has(error.code ?? '')
      ? { certificateIssue: true } : undefined));
    request.once('close', () => { clearTimeout(timeout); resolve(undefined); });
    request.end();
  });
}

async function identify(url: URL, localAddress: string) {
  const first = await readPage(url, localAddress, 500);
  if (!first?.redirect) return first;
  const landing = URL.parse(first.redirect, url);
  if (!landing || landing.origin !== url.origin || landing.username || landing.password) return {};
  const next = await readPage(landing, localAddress, 500);
  return next ?? {};
}

export async function discoverWebServices(address: string, prefix: number) {
  const { hosts } = webScope(address, prefix);
  const targets = homelabPorts.flatMap(port => hosts.map(host => ({ host, port })));
  const services: { title: string; url: string; category: string; description: string; identified: boolean }[] = [];
  let next = 0;
  const deadline = Date.now() + 90_000;
  await Promise.all(Array.from({ length: 48 }, async () => {
    while (next < targets.length && Date.now() < deadline) {
      const { host, port } = targets[next++];
      const secure = httpsPorts.has(port);
      const url = new URL(`${secure ? 'https' : 'http'}://${host}:${port}/`);
      const result = await identify(url, address);
      if (result) {
        services.push({ ...describeService(host, port, pageNames(result.html ?? ''), !!result.certificateIssue), url: url.href });
      }
    }
  }));
  return { services, checked: next, total: targets.length };
}
