import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import type { DatabaseSync } from 'node:sqlite';
import ssh2, { type Client, type ClientChannel, type SFTPWrapper } from 'ssh2';
import { z } from 'zod';
import { DiagnosticError } from './diagnostics.ts';
import { fileOperation } from './ssh-files.ts';

const hostFingerprint = z.string().trim().regex(/^SHA256:[A-Za-z0-9+/]{43}$/);
const hostInput = z.object({
  name: z.string().trim().min(1).max(80),
  host: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.@-]+$/),
  fingerprint: z.union([hostFingerprint, z.literal('')]).optional(),
});
const fingerprintOf = (key: Buffer) => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
type Host = z.infer<typeof hostInput>;
type Connection = {
  client: Client; owner: string; hostId: number; created: number; closed: boolean;
  shell?: ClientChannel; sftp?: SFTPWrapper; output: string; offset: number; inputSequence: number;
  shellOpening?: Promise<void>; cpu?: { total: number; idle: number };
  network?: { at: number; rx: number; tx: number }; outputEvents: EventEmitter; waitingForOutput?: boolean;
  fileOperation?: AbortController;
};
const remotePath = z.string().min(1).max(4096).refine(value => !value.includes('\0'));
const statsCommand = `printf '__SYSTEM__\\n'; uname -srm; hostname; printf '__UPTIME__\\n'; cat /proc/uptime; printf '__CPU__\\n'; head -n 1 /proc/stat; getconf _NPROCESSORS_ONLN; printf '__MEMORY__\\n'; cat /proc/meminfo; printf '__LOAD__\\n'; cat /proc/loadavg; printf '__NETWORK__\\n'; cat /proc/net/dev; printf '__DISKS__\\n'; df -Pk; printf '__PROCESSES__\\n'; ps -eo pid,comm,pcpu,pmem --sort=-pcpu | head -n 11`;

function deadline<T>(work: Promise<T>, milliseconds = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DiagnosticError(504, 'The remote operation timed out.')), milliseconds);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function configureSsh(db: DatabaseSync, enabled: boolean, secureTransport: boolean) {
  const sessions = new Map<string, Connection>();
  const connecting = new Set<string>();
  const ownerQuery = db.prepare("SELECT 1 FROM sessions JOIN accounts ON accounts.id=sessions.account_id WHERE token=? AND expires>? AND idle_until>? AND role='admin'");
  function validOwner(owner: string) {
    const now = Date.now();
    return ownerQuery.get(owner, now, now);
  }
  function close(id: string) {
    const connection = sessions.get(id);
    if (!connection) return;
    sessions.delete(id);
    connection.closed = true;
    connection.outputEvents.emit('change');
    connection.fileOperation?.abort();
    connection.shell?.destroy();
    connection.sftp?.end();
    connection.client.end();
    connection.client.destroy();
  }
  const timer = setInterval(() => {
    for (const [id, session] of sessions) {
      if (!validOwner(session.owner) || Date.now() - session.created > 60 * 60_000) close(id);
    }
  }, 5_000);
  timer.unref();
  function list() {
    return db.prepare("SELECT id,payload FROM admin_records WHERE kind='ssh-host' ORDER BY label").all()
      .map(row => ({ id: Number(row.id), ...JSON.parse(String(row.payload)) as Host }));
  }
  function owned(id: string, owner: string) {
    const session = sessions.get(id);
    if (!session || session.owner !== owner) throw new DiagnosticError(404, 'SSH session not found. Connect again.');
    if (!validOwner(owner) || Date.now() - session.created > 60 * 60_000) {
      close(id);
      throw new DiagnosticError(410, 'SSH session expired. Connect again.');
    }
    return session;
  }
  async function sftp(session: Connection) {
    if (session.closed) throw new DiagnosticError(410, 'SSH connection closed.');
    if (!session.sftp) session.sftp = await deadline(new Promise<SFTPWrapper>((resolve, reject) => {
      session.client.sftp((error, channel) => error ? reject(error) : resolve(channel));
    }));
    return session.sftp;
  }
  async function stats(session: Connection) {
    const output = await deadline(new Promise<string>((resolve, reject) => {
      session.client.exec(statsCommand, (error, stream) => {
        if (error) return reject(error);
        let output = '';
        stream.on('data', (chunk: Buffer) => {
          output += chunk.toString();
          if (output.length > 128_000) { stream.destroy(); reject(new Error('Statistics output too large.')); }
        });
        stream.on('error', reject);
        stream.on('close', () => resolve(output));
      });
    }));
    const sections = new Map<string, string>();
    const parts = output.split(/__(SYSTEM|UPTIME|CPU|MEMORY|LOAD|NETWORK|DISKS|PROCESSES)__\r?\n/);
    for (let index = 1; index < parts.length; index += 2) sections.set(parts[index], parts[index + 1].trim());
    if (!sections.get('MEMORY')?.includes('MemTotal:')) throw new DiagnosticError(422, 'Machine statistics require Linux with procfs and standard system utilities.');
    const memory = Object.fromEntries((sections.get('MEMORY') ?? '').split('\n').map(line => {
      const [key, value] = line.split(/:\s*/);
      return [key, Number.parseInt(value) * 1024];
    }));
    const cpuLines = (sections.get('CPU') ?? '').split('\n');
    const cpu = cpuLines[0].trim().split(/\s+/).slice(1, 9).map(Number);
    const total = cpu.reduce((sum, value) => sum + value, 0);
    const idle = (cpu[3] ?? 0) + (cpu[4] ?? 0);
    const previous = session.cpu;
    const cpuPercent = previous && total > previous.total
      ? Math.max(0, Math.min(100, 100 * (1 - (idle - previous.idle) / (total - previous.total)))) : null;
    session.cpu = { total, idle };
    let rx = 0;
    let tx = 0;
    for (const line of (sections.get('NETWORK') ?? '').split('\n')) {
      const [name, values] = line.split(':');
      if (!values || name.trim() === 'lo') continue;
      const counters = values.trim().split(/\s+/).map(Number);
      rx += counters[0]; tx += counters[8];
    }
    const now = Date.now();
    const before = session.network;
    const seconds = before ? (now - before.at) / 1000 : 0;
    session.network = { at: now, rx, tx };
    return { system: sections.get('SYSTEM'), uptime: Number((sections.get('UPTIME') ?? '').split(' ')[0]),
      cores: Number(cpuLines[1]), cpuPercent, load: (sections.get('LOAD') ?? '').split(' ').slice(0, 3).map(Number),
      memory: { total: memory.MemTotal, available: memory.MemAvailable ?? memory.MemFree, swapTotal: memory.SwapTotal, swapFree: memory.SwapFree },
      network: { rx, tx, rxPerSecond: before && seconds > 0 ? Math.max(0, (rx - before.rx) / seconds) : null,
        txPerSecond: before && seconds > 0 ? Math.max(0, (tx - before.tx) / seconds) : null },
      disks: sections.get('DISKS'), processes: sections.get('PROCESSES') };
  }

  return {
    closeOwner(owner: string) { for (const [id, session] of sessions) if (session.owner === owner) close(id); },
    close() { clearInterval(timer); for (const id of sessions.keys()) close(id); },
    async handle(method: string, path: string, input: unknown, owner: string, localTransport = false, requestSignal?: AbortSignal) {
      if (!path.startsWith('/api/admin/diagnostics/ssh')) return undefined;
      if (method === 'GET' && path === '/api/admin/diagnostics/ssh') return { enabled, secureTransport: secureTransport || localTransport, hosts: list() };
      if (!enabled) throw new DiagnosticError(403, 'Enable NEXUS_SSH=on in the server environment to use SSH.');
      if (method === 'POST' && path === '/api/admin/diagnostics/ssh/hosts') {
        const host = hostInput.parse(input);
        const id = db.prepare("INSERT INTO admin_records(kind,label,created,payload) VALUES ('ssh-host',?,?,?)")
          .run(host.name, new Date().toISOString(), JSON.stringify(host)).lastInsertRowid;
        return { id: Number(id) };
      }
      const trustMatch = /^\/api\/admin\/diagnostics\/ssh\/hosts\/([1-9]\d*)\/(probe|trust)$/.exec(path);
      if (trustMatch && method === 'POST') {
        if (!secureTransport && !localTransport) throw new DiagnosticError(403, 'Open StackJetty over HTTPS or the private SSH tunnel to review host keys.');
        const id = Number(trustMatch[1]);
        const host = list().find(host => host.id === id);
        if (!host) throw new DiagnosticError(404, 'Machine not found.');
        if (host.fingerprint) throw new DiagnosticError(409, 'This machine already has a trusted host key.');
        if (trustMatch[2] === 'trust') {
          const { fingerprint } = z.object({ fingerprint: hostFingerprint }).parse(input);
          const updated = db.prepare(`UPDATE admin_records SET payload=json_set(payload,'$.fingerprint',?)
            WHERE kind='ssh-host' AND id=? AND coalesce(json_extract(payload,'$.fingerprint'),'')=''`).run(fingerprint, id);
          if (!updated.changes) throw new DiagnosticError(409, 'The saved machine changed. Reload and try again.');
          return {};
        }
        if (connecting.has(owner) || sessions.size + connecting.size >= 8) throw new DiagnosticError(429, 'An SSH connection is already opening or the session limit was reached.');
        const client = new ssh2.Client();
        connecting.add(owner);
        try {
          const fingerprint = await deadline(new Promise<string>((resolve, reject) => {
            client.on('error', reject);
            client.once('close', () => reject(new Error('SSH connection closed.')));
            client.connect({ host: host.host, port: host.port, username: host.username, readyTimeout: 10_000,
              hostVerifier(key: Buffer) {
                resolve(fingerprintOf(key));
                return false; // Stop before authenticating.
              } });
          }), 12_000);
          return { fingerprint };
        } catch {
          throw new DiagnosticError(502, 'Could not read the SSH host key. Check the address and port.');
        } finally {
          client.destroy();
          connecting.delete(owner);
        }
      }
      const hostMatch = /^\/api\/admin\/diagnostics\/ssh\/hosts\/([1-9]\d*)$/.exec(path);
      if (hostMatch && method === 'DELETE') {
        const id = Number(hostMatch[1]);
        for (const [key, session] of sessions) if (session.hostId === id) close(key);
        if (!db.prepare("DELETE FROM admin_records WHERE kind='ssh-host' AND id=?").run(id).changes) throw new DiagnosticError(404, 'Machine not found.');
        return {};
      }
      if (path === '/api/admin/diagnostics/ssh/connect' && method === 'POST') {
        if (!secureTransport && !localTransport) throw new DiagnosticError(403, 'SSH credentials require HTTPS or a verified localhost connection.');
        if (connecting.has(owner) || sessions.size + connecting.size >= 8) throw new DiagnosticError(429, 'An SSH connection is already opening or the session limit was reached.');
        const credentials = z.object({ hostId: z.number().int().positive(), authentication: z.enum(['password', 'private-key']).optional(), password: z.string().max(4096).optional(),
          privateKey: z.string().max(32768).optional(), passphrase: z.string().max(4096).optional() }).parse(input);
        const method = credentials.authentication ?? (credentials.privateKey ? 'private-key' : 'password');
        if (method === 'password' ? !credentials.password : !credentials.privateKey) {
          throw new DiagnosticError(400, method === 'password' ? 'Enter the SSH password.' : 'Enter the session private key.');
        }
        const host = list().find(host => host.id === credentials.hostId);
        if (!host) throw new DiagnosticError(404, 'Machine not found.');
        if (!host.fingerprint) throw new DiagnosticError(409, 'Review and trust the machine’s host key before signing in.');
        connecting.add(owner);
        const client = new ssh2.Client();
        let verified = false;
        try {
          await deadline(new Promise<void>((resolve, reject) => {
            client.once('ready', resolve);
            client.on('error', reject);
            client.on('keyboard-interactive', (_name, _instructions, _language, prompts, finish) => {
              const passwordPrompt = prompts.length === 1 && !prompts[0].echo && /^\s*password(?:\s+for\s+[^:]+)?\s*:\s*$/i.test(prompts[0].prompt);
              finish(method === 'password' && passwordPrompt ? [credentials.password!] : []);
            });
            client.connect({ host: host.host, port: host.port, username: host.username,
              authHandler: method === 'password' ? ['password', 'keyboard-interactive'] : ['publickey'],
              tryKeyboard: method === 'password',
              password: method === 'password' ? credentials.password : undefined,
              privateKey: method === 'private-key' ? credentials.privateKey : undefined,
              passphrase: method === 'private-key' ? credentials.passphrase : undefined, readyTimeout: 10_000, keepaliveInterval: 20_000,
              hostVerifier(key: Buffer) {
                verified = fingerprintOf(key) === host.fingerprint;
                return verified;
              } });
          }), 12_000);
        } catch {
          client.destroy();
          throw new DiagnosticError(502, verified ? 'SSH authentication or connection failed.' : 'SSH connection or trusted host-key verification failed.');
        } finally { connecting.delete(owner); }
        if (!validOwner(owner)) { client.destroy(); throw new DiagnosticError(401, 'Sign in to continue.'); }
        const id = randomBytes(24).toString('hex');
        const session: Connection = { client, owner, hostId: host.id, created: Date.now(),
          closed: false, output: '', offset: 0, inputSequence: 0, outputEvents: new EventEmitter() };
        client.on('close', () => close(id));
        sessions.set(id, session);
        return { id, name: host.name };
      }
      const match = /^\/api\/admin\/diagnostics\/ssh\/([a-f0-9]{48})(?:\/(stats|files|file|file-operation|shell|output|input|resize))?$/.exec(path);
      if (!match) throw new DiagnosticError(404, 'SSH endpoint not found.');
      const [, id, resource] = match;
      const session = owned(id, owner);
      if (!resource && method === 'DELETE') { close(id); return {}; }
      if (resource === 'file-operation' && method === 'POST') {
        if (session.fileOperation) throw new DiagnosticError(409, 'Wait for the current file operation to finish.');
        const controller = new AbortController();
        session.fileOperation = controller;
        const timeout = setTimeout(() => {
          controller.abort();
          session.sftp?.end();
          session.sftp = undefined;
        }, 45_000);
        try {
          return await fileOperation(await sftp(session), input, controller.signal);
        } catch (error) {
          if (error instanceof DiagnosticError || error instanceof z.ZodError) throw error;
          throw new DiagnosticError(502, controller.signal.aborted
            ? 'The operation was interrupted. Refresh to check the remote files.'
            : 'The remote machine could not complete the operation. Check permissions and refresh the folder.');
        } finally {
          clearTimeout(timeout);
          session.fileOperation = undefined;
        }
      }
      if (resource === 'stats' && method === 'GET') return stats(session);
      if (resource === 'files' && method === 'POST') {
        const path = z.object({ path: remotePath }).parse(input).path;
        const channel = await sftp(session);
        const actual = await deadline(new Promise<string>((resolve, reject) =>
          channel.realpath(path, (error, result) => error ? reject(error) : resolve(result))));
        const entries = await deadline(new Promise<{ name: string; directory: boolean; link: boolean; size: number; modified: number }[]>((resolve, reject) => {
          channel.readdir(actual, (error, entries) => error ? reject(error) : resolve(entries.slice(0, 2000).map(entry => ({
            name: entry.filename, directory: entry.attrs.isDirectory(), link: entry.attrs.isSymbolicLink(),
            size: entry.attrs.size, modified: entry.attrs.mtime,
          }))));
        }));
        return { path: actual, entries };
      }
      if (resource === 'file' && method === 'POST') {
        const path = z.object({ path: remotePath }).parse(input).path;
        const channel = await sftp(session);
        const result = await deadline(new Promise<Buffer>((resolve, reject) => {
          const stream = channel.createReadStream(path, { start: 0, end: 131071 });
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('error', reject);
          stream.on('end', () => resolve(Buffer.concat(chunks)));
        }));
        return { text: result.includes(0) ? 'Binary file. Text preview is unavailable.' : result.toString('utf8'), limit: 131072 };
      }
      if (resource === 'shell' && method === 'POST') {
        if (!session.shellOpening) session.shellOpening = deadline(new Promise<void>((resolve, reject) => {
          session.client.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (error, stream) => {
            if (error) return reject(error);
            session.shell = stream;
            const decoder = new StringDecoder('utf8');
            stream.on('data', (chunk: Buffer) => {
              session.output += decoder.write(chunk);
              if (session.output.length > 262144) {
                const trim = session.output.length - 262144;
                session.output = session.output.slice(trim); session.offset += trim;
              }
              session.outputEvents.emit('change');
            });
            stream.on('close', () => session.outputEvents.emit('change'));
            stream.on('error', () => {});
            resolve();
          });
        }));
        await session.shellOpening;
        return {};
      }
      if (resource === 'output' && method === 'POST') {
        const { cursor, wait } = z.object({ cursor: z.number().int().nonnegative(), wait: z.boolean().optional() }).parse(input);
        if (wait && session.shell && !session.shell.destroyed && !session.closed && cursor === session.offset + session.output.length) {
          if (session.waitingForOutput) throw new DiagnosticError(409, 'A shell output request is already waiting.');
          session.waitingForOutput = true;
          try {
            await new Promise<void>(resolve => {
              const finish = () => {
                clearTimeout(timeout);
                session.outputEvents.off('change', finish);
                requestSignal?.removeEventListener('abort', finish);
                resolve();
              };
              const timeout = setTimeout(finish, 15_000);
              session.outputEvents.once('change', finish);
              if (requestSignal?.aborted) finish();
              else requestSignal?.addEventListener('abort', finish, { once: true });
            });
          } finally { session.waitingForOutput = false; }
        }
        if (!validOwner(owner)) throw new DiagnosticError(401, 'Sign in to continue.');
        const start = Math.max(session.offset, Math.min(cursor, session.offset + session.output.length));
        return { output: session.output.slice(start - session.offset), cursor: session.offset + session.output.length,
          truncated: cursor < session.offset, closed: session.closed || session.shell?.destroyed === true };
      }
      if (resource === 'input' && method === 'POST') {
        const request = z.object({ sequence: z.number().int().positive(), data: z.string().max(16384) }).parse(input);
        if (!session.shell || session.shell.destroyed) throw new DiagnosticError(410, 'The shell is closed.');
        if (request.sequence <= session.inputSequence) return {};
        if (request.sequence !== session.inputSequence + 1) throw new DiagnosticError(409, 'Shell input is out of order. Reconnect.');
        session.shell.write(request.data);
        session.inputSequence = request.sequence;
        return {};
      }
      if (resource === 'resize' && method === 'POST') {
        const size = z.object({ rows: z.number().int().min(2).max(200), columns: z.number().int().min(10).max(300) }).parse(input);
        session.shell?.setWindow(size.rows, size.columns, 0, 0);
        return {};
      }
      throw new DiagnosticError(404, 'SSH endpoint not found.');
    },
  };
}
