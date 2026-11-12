const catalog: readonly (readonly [name: string, category: string, ...ports: number[]])[] = [
  ["Jellyfin","Media",8096,8920],
  ["Emby","Media",8096,8920],
  ["Plex","Media",32400],
  ["Immich","Photos",2283],
  ["PhotoPrism","Photos",2342],
  ["Audiobookshelf","Media",13378],
  ["Navidrome","Media",4533],
  ["Tautulli","Media",8181],
  ["Sonarr","Media automation",8989],
  ["Radarr","Media automation",7878],
  ["Lidarr","Media automation",8686],
  ["Readarr","Media automation",8787],
  ["Prowlarr","Media automation",9696],
  ["Bazarr","Media automation",6767],
  ["Seerr","Media automation",5055],
  ["Overseerr","Media automation",5055],
  ["Jellyseerr","Media automation",5055],
  ["Jackett","Media automation",9117],
  ["qBittorrent","Downloads",8080],
  ["SABnzbd","Downloads",8080],
  ["Transmission","Downloads",9091],
  ["Deluge","Downloads",8112],
  ["NZBGet","Downloads",6789],
  ["Proxmox VE","Infrastructure",8006],
  ["Proxmox Backup Server","Infrastructure",8007],
  ["Portainer","Infrastructure",9443,9000],
  ["OpenMediaVault","Infrastructure",80,443],
  ["TrueNAS","Infrastructure",80,443],
  ["Synology DiskStation","Infrastructure",5000,5001],
  ["Cockpit","Infrastructure",9090],
  ["Home Assistant","Home automation",8123],
  ["Node-RED","Home automation",1880],
  ["openHAB","Home automation",8080,8443],
  ["Grafana","Monitoring",3000],
  ["Prometheus","Monitoring",9090],
  ["Uptime Kuma","Monitoring",3001],
  ["Netdata","Monitoring",19999],
  ["Glances","Monitoring",61208],
  ["Pi-hole","Networking",80,443],
  ["AdGuard Home","Networking",3000,80,443],
  ["Nginx Proxy Manager","Networking",81],
  ["Traefik","Networking",8080],
  ["Gitea","Development",3000],
  ["Forgejo","Development",3000],
  ["Nextcloud","Productivity",80,443],
  ["Vaultwarden","Productivity",80,443],
  ["Syncthing","Storage",8384],
  ["MinIO","Storage",9000,9001],
  ["Frigate","Cameras",8971,5000],
  ["Homebridge","Home automation",8581],
];

export const homelabPorts = [...new Set([80, 443, 8000, 8081, ...catalog.flatMap(([, , ...ports]) => ports)])];
export const httpsPorts = new Set([443, 5001, 8006, 8007, 8443, 8920, 8971, 9443]);

const titleAliases = new Map([
  ['Proxmox VE', /^(?:[\w.-]+\s*[-–]\s*)?Proxmox Virtual Environment(?:\b|$)/i],
]);

const generic = /^(?:(?:user |admin )?(?:login|log in|sign in)|home|welcome(?: to nginx!)?|dashboard|web interface|index of.*|(?:[45]\d\d\s+)?(?:unauthorized|forbidden|not found|bad gateway|service unavailable)|(?:apache2?|nginx|iis).*default (?:page|website))$/i;

function clean(value: string) {
  return value.replace(/&(?:amp|quot|apos|#39|nbsp);/gi, entity => ({
    '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ',
  })[entity.toLowerCase()] ?? entity).replace(/[\s\x00-\x1f]+/g, ' ').trim();
}

export function pageNames(html: string) {
  const names: string[] = [];
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
      .map(([, key, double, single, plain]) => [key.toLowerCase(), double ?? single ?? plain]));
    if (['application-name', 'apple-mobile-web-app-title', 'og:site_name'].includes((attrs.get('name') ?? attrs.get('property') ?? '').toLowerCase())) {
      names.push(clean(attrs.get('content') ?? ''));
    }
  }
  const title = html.match(/<title\b[^>]*>([^<]{1,240})<\/title\s*>/i)?.[1];
  if (title) names.push(clean(title));
  return names.filter(name => name && !generic.test(name));
}

export function describeService(host: string, port: number, names: string[], certificateIssue: boolean) {
  const named = catalog.find(([product]) => names.some(name => titleAliases.get(product)?.test(name) ||
    name.split(/\s+[-–—|:]\s+|:\s+/).some(part => part.toLowerCase() === product.toLowerCase())));
  const reported = named?.[0] ?? names[0]?.slice(0, 80);
  const hints = reported ? [] : catalog.filter(([, , ...ports]) => ports.includes(port));
  const guess = hints.length === 1 ? hints[0] : undefined;
  const hint = hints.length ? 'Port suggestion: ' + hints.map(([name]) => name).join(', ') + '.' : '';
  return {
    title: reported ?? guess?.[0] ?? host + ':' + port,
    category: named?.[1] ?? guess?.[1] ?? 'Discovered services',
    description: (certificateIssue ? 'TLS certificate could not be verified. ' : '') +
      (reported ? 'Name reported by the web interface.' : hint || 'Responded to a web request.'),
    identified: !!reported,
  };
}
