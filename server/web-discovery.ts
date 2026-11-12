import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const ports = [80, 443, 3000, 5000, 5001, 8000, 8006, 8080, 8081, 8096, 8123, 8443, 8920, 9000, 9443];
const securePorts = new Set([443, 5001, 8006, 8443, 8920, 9443]);

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

function responds(host: string, port: number, localAddress: string, secure: boolean) {
  return new Promise<boolean>(resolve => {
    const request = (secure ? httpsRequest : httpRequest)({
      host, port, localAddress, method: 'HEAD', path: '/', agent: false,
      maxHeaderSize: 8192,
    }, response => {
      response.destroy();
      resolve(true);
    });
    const timeout = setTimeout(() => request.destroy(), 500);
    request.once('error', () => resolve(false));
    request.once('close', () => clearTimeout(timeout));
    request.end();
  });
}

export async function discoverWebServices(address: string, prefix: number) {
  const targets = webScope(address, prefix).hosts.flatMap(host => ports.map(port => ({ host, port })));
  const services: { title: string; url: string; category: string; description: string }[] = [];
  let next = 0;
  const deadline = Date.now() + 45_000;
  await Promise.all(Array.from({ length: 48 }, async () => {
    while (next < targets.length && Date.now() < deadline) {
      const { host, port } = targets[next++];
      const secure = securePorts.has(port);
      if (await responds(host, port, address, secure)) {
        const url = new URL(`${secure ? 'https' : 'http'}://${host}:${port}/`).href;
        services.push({ title: `${host}:${port}`, url, category: 'Discovered services', description: 'Responded to a web request' });
      }
    }
  }));
  return { services, checked: next, total: targets.length };
}
