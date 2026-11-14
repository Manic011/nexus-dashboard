import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';

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

type Page = { html?: string; redirect?: string; certificateIssue?: boolean; server?: string; redirectTo?: string };

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
      const contentType = response.headers['content-type']?.toLowerCase() ?? '';
      if ([404, 405, 410].includes(response.statusCode ?? 0) || contentType.includes('soap+xml')) {
        resolve(undefined);
        response.destroy();
        return;
      }
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) return finish({});
      let html = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        html += String(chunk).slice(0, 16384 - html.length);
        if (html.length >= 16384) finish({ html, server: response.headersDistinct.server?.[0] });
      });
      response.on('end', () => finish({ html, server: response.headersDistinct.server?.[0] }));
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

const certificateNames = new Map([
  ['unifi.local', 'UniFi'],
  ['tplinkwifi.net', 'TP-Link Router'],
  ['tplinklogin.net', 'TP-Link Router'],
]);

function certificateName(url: URL, localAddress: string) {
  return new Promise<string | undefined>(resolve => {
    // Read the advertised certificate only. No HTTP data is sent on this connection.
    const options = { host: url.hostname, port: Number(url.port || 443), localAddress, rejectUnauthorized: false };
    const socket = tlsConnect(options);
    const timer = setTimeout(() => socket.destroy(), 500);
    socket.once('secureConnect', () => {
      const commonName = socket.getPeerCertificate()?.subject?.CN;
      resolve(typeof commonName === 'string' ? certificateNames.get(commonName.toLowerCase()) : undefined);
      socket.destroy();
    });
    socket.once('error', () => resolve(undefined));
    socket.once('close', () => { clearTimeout(timer); resolve(undefined); });
  });
}

function refreshLocation(html: string) {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/\bhttp-equiv\s*=\s*(?:"refresh"|'refresh'|refresh(?=\s|\/|>))/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const location = /^\s*0\s*;\s*url\s*=\s*(.+)\s*$/i.exec(content?.[1] ?? content?.[2] ?? '')?.[1];
    if (location) return location.replace(/^(['"])(.*)\1$/, '$2').trim();
  }
}

function interfaceNames(page: Page) {
  const html = page.html ?? '';
  if (/\bsrc=["'][^"']*\/tpEncrypt\.js(?:[?"'])/i.test(html)) return ['TP-Link Router'];
  if (/^gSOAP\//i.test(page.server ?? '') && /\bapi_pluginPlay\//i.test(html) && /\bapi_html5Play\//i.test(html)) {
    return ['Camera web interface'];
  }
  return pageNames(html).filter(name => !/^opening\.{0,3}$/i.test(name));
}

async function identify(url: URL, localAddress: string) {
  const first = await readPage(url, localAddress, 500);
  if (!first) return undefined;
  const location = first.redirect ?? refreshLocation(first.html ?? '');
  if (!location) return first;
  const landing = URL.parse(location, url);
  if (!landing || landing.username || landing.password) return first;
  if (landing.origin === url.origin && landing.href !== url.href) {
    return await readPage(landing, localAddress, 500);
  }
  if (url.protocol === 'http:' && landing.protocol === 'https:' && landing.hostname === url.hostname &&
      httpsPorts.has(Number(landing.port || 443))) {
    return { redirectTo: new URL('/', landing).href };
  }
  return first;
}

export function planWebScan(address: string, prefix: number, options: { range?: string; exclude?: string; ports?: string } = {}) {
  const scope = webScope(address, prefix);
  const localHosts = new Set(scope.hosts);
  const ipNumber = (ip: string) => {
    if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split('.').some(octet => Number(octet) > 255)) throw new Error('Use valid IPv4 addresses.');
    return ip.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
  };
  const format = (value: number) => [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.');
  const privateIp = (ip: number) => (ip >= 0x0a000000 && ip <= 0x0affffff) ||
    (ip >= 0xac100000 && ip <= 0xac1fffff) || (ip >= 0xc0a80000 && ip <= 0xc0a8ffff);
  const selectHosts = (input: string) => {
    const selected = new Set<string>();
    for (const part of input.split(',')) {
      let first: number, last: number;
      if (part.includes('/')) {
        const match = /^(.*?)\/(\d{1,2})$/.exec(part.trim());
        if (!match || Number(match[2]) > 32) throw new Error('Use IPv4 CIDR prefixes from 0 to 32.');
        const size = 2 ** (32 - Number(match[2]));
        first = Math.floor(ipNumber(match[1]) / size) * size;
        last = first + size - 1;
        if (size > 2) { first++; last--; }
      } else {
        const parts = part.trim().split('-').map(value => value.trim());
        if (parts.length > 2) throw new Error('Use an IPv4 address, CIDR, or start–end range.');
        first = ipNumber(parts[0]); last = ipNumber(parts[1] ?? parts[0]);
      }
      if (last < first || last - first + 1 > 4096) throw new Error('Select at most 4096 addresses per scan.');
      for (let ip = first; ip <= last; ip++) {
        if (!privateIp(ip) && !localHosts.has(format(ip))) throw new Error('Targets outside the selected subnet must use private IPv4 addresses (10/8, 172.16/12, or 192.168/16).');
        selected.add(format(ip));
        if (selected.size > 4096) throw new Error('Select at most 4096 addresses per scan.');
      }
    }
    return selected;
  };
  const selected = options.range?.trim() ? selectHosts(options.range) : new Set(scope.hosts);
  const excluded = options.exclude?.trim() ? selectHosts(options.exclude) : new Set<string>();
  const hosts = [...selected].filter(host => !excluded.has(host)).sort((a, b) => ipNumber(a) - ipNumber(b));
  if (!hosts.length) throw new Error('Select at least one address after exclusions.');

  const custom = new Set<number>();
  if (options.ports?.trim()) {
    for (const part of options.ports.split(',')) {
      const match = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(part.trim());
      const first = Number(match?.[1]);
      const last = Number(match?.[2] ?? first);
      if (!match || first < 1 || last > 65535 || last < first) throw new Error('Use ports from 1 to 65535 or ranges such as 8000-8010.');
      for (let port = first; port <= last; port++) custom.add(port);
    }
  }
  const ports = custom.size ? [...custom].sort((a, b) => a - b) : homelabPorts;
  return { cidr: scope.cidr, hosts, ports, checks: hosts.length * ports.length };
}

export async function discoverWebServices(address: string, prefix: number, progress?: (checked: number, total: number) => void, plan = planWebScan(address, prefix), cancelled = () => false) {
  const { hosts, ports } = plan;
  const services: { title: string; url: string; category: string; description: string; identified: boolean; source: string }[] = [];
  const upgrades = new Map<string, string>();
  let next = 0;
  let completed = 0;
  progress?.(0, plan.checks);
  await Promise.all(Array.from({ length: 48 }, async () => {
    while (next < plan.checks && !cancelled()) {
      const index = next++;
      const host = hosts[index % hosts.length];
      const port = ports[Math.floor(index / hosts.length)];
      try {
        const secure = httpsPorts.has(port);
        const url = new URL(`${secure ? 'https' : 'http'}://${host}:${port}/`);
        const result = await identify(url, address);
        if (!result) continue;
        if (result.redirectTo) {
          upgrades.set(url.href, result.redirectTo);
          continue;
        }
        const certificate = result.certificateIssue ? await certificateName(url, address) : undefined;
        const names = interfaceNames(result);
        const description = describeService(host, port, names, !!result.certificateIssue);
        services.push(certificate ? {
          ...description,
          title: certificate,
          category: 'Networking',
          description: 'Device suggested by an unverified TLS certificate.',
          identified: true,
          source: 'TLS certificate (unverified)',
          url: url.href,
        } : { ...description, source: description.identified ? 'Web page' : description.description.includes('Port suggestion') ? 'Port match' : 'Unidentified', url: url.href });
      } finally {
        progress?.(++completed, plan.checks);
      }
    }
  }));
  const foundUrls = new Set(services.map(service => service.url));
  for (const [source, target] of upgrades) {
    if (foundUrls.has(target)) continue;
    const url = new URL(source);
    services.push({
      ...describeService(url.hostname, Number(url.port || 80), [], false),
      description: 'Redirects to HTTPS.',
      source: 'HTTP redirect',
      url: source,
    });
  }
  return { services, checked: completed, total: plan.checks, cancelled: cancelled() };
}
