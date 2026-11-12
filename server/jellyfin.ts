type Summary = { state: 'available'; streams: number } | { state: 'unavailable' };
type Config = { baseUrl: string; apiKey: string };

function normalizeUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Jellyfin requires an HTTP or HTTPS base URL without credentials, a query, or a fragment.');
  }
  return url.href.replace(/\/$/, '');
}

export function createJellyfin(config?: Config) {
  if (!config) return undefined;
  const base = normalizeUrl(config.baseUrl);
  let cached: { expires: number; result: Promise<Summary> } | undefined;

  async function load(): Promise<Summary> {
    try {
      const response = await fetch(base + '/Sessions', {
        headers: { Accept: 'application/json', Authorization: 'MediaBrowser Token="' + config!.apiKey + '"' },
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return { state: 'unavailable' };
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2_000_000) return { state: 'unavailable' };
        chunks.push(Buffer.from(chunk));
      }
      const sessions: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(sessions)) return { state: 'unavailable' };
      return { state: 'available', streams: sessions.filter(item => item?.NowPlayingItem).length };
    } catch {
      return { state: 'unavailable' };
    }
  }

  return {
    matches(value: string) {
      try { return normalizeUrl(value) === base; } catch { return false; }
    },
    summary() {
      if (!cached || cached.expires < Date.now()) cached = { expires: Date.now() + 30_000, result: load() };
      return cached.result;
    },
  };
}
