import { networkInterfaces } from 'node:os';
import { BlockList, isIPv4 } from 'node:net';
import mdns from 'multicast-dns';

export function discoveryInterfaces() {
  return Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? []).filter(entry => entry.family === 'IPv4' && !entry.internal && entry.cidr)
      .map(entry => ({ name, address: entry.address, cidr: entry.cidr! })));
}

const types = new Map([['_http._tcp.local', 'http'], ['_https._tcp.local', 'https']]);
const normalize = (name: string) => name.replace(/\.$/, '').toLowerCase();

export async function discoverServices(address: string, prefix: number) {
  const scope = new BlockList();
  scope.addSubnet(address, prefix);
  const socket = mdns({ interface: address, bind: '0.0.0.0', ttl: 1 });
  const pointers = new Map<string, { title: string; protocol: string }>();
  const endpoints = new Map<string, { target: string; port: number }>();
  const hosts = new Map<string, string>();

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 3000);
      socket.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on('response', (packet, sender) => {
        if (!isIPv4(sender.address) || !scope.check(sender.address) || sender.port !== 5353) return;
        for (const record of [...packet.answers, ...packet.additionals]) {
          const name = normalize(record.name);
          if (!('ttl' in record) || record.ttl === 0) continue;
          if (record.type === 'PTR' && pointers.size < 150) {
            const protocol = types.get(name);
            const instance = normalize(record.data);
            if (protocol && instance.endsWith('.' + name)) {
              const title = record.data.slice(0, instance.length - name.length - 1).trim().slice(0, 80);
              if (title) pointers.set(instance, { title, protocol });
            }
          }
          if (record.type === 'SRV' && endpoints.size < 300 && record.data.port > 0) {
            endpoints.set(name, { target: normalize(record.data.target), port: record.data.port });
          }
          if (record.type === 'A' && hosts.size < 300 && isIPv4(record.data) && scope.check(record.data)) {
            hosts.set(name, record.data);
          }
        }
      });
      socket.query({ questions: [...types.keys()].map(name => ({ name, type: 'PTR' })) });
    });
    return [...pointers.entries()].flatMap(([name, service]) => {
      const endpoint = endpoints.get(name);
      const host = endpoint && hosts.get(endpoint.target);
      if (!endpoint || !host) return [];
      const url = new URL(`${service.protocol}://${host}:${endpoint.port}/`).href;
      return [{ title: service.title, url, category: 'Discovered services', description: '' }];
    });
  } finally {
    socket.destroy();
  }
}
