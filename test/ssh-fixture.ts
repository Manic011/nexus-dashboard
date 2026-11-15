import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { posix } from 'node:path';

export function createSshFixture(realMachine = false, authentication: 'password' | 'keyboard-interactive' = 'password') {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const parsed = ssh2.utils.parseKey(key);
  assert.ok(!Array.isArray(parsed) && !(parsed instanceof Error));
  const fingerprint = 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '');
  const sshServer = new ssh2.Server({ hostKeys: [key] });
  const received: string[] = [];
  const input = new EventEmitter();
  const files = new Map<string, Buffer | null>([['/', null], ['/fixture', null], ['/fixture/hello.txt', Buffer.from('hello')]]);
  sshServer.on('connection', client => {
    client.on('error', () => {});
    client.on('authentication', context => {
      if (authentication === 'keyboard-interactive' && context.method === 'keyboard-interactive' && context.username === 'fixture') {
        context.prompt([{ prompt: 'Password: ', echo: false }], answers => {
          if (answers[0] === 'fixture-password') context.accept();
          else context.reject();
        });
      } else if (authentication === 'password' && context.method === 'password' && context.username === 'fixture' && context.password === 'fixture-password') context.accept();
      else context.reject([authentication]);
    });
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', accept => accept());
      session.on('window-change', accept => accept?.());
      session.on('shell', accept => {
        const stream = accept();
        if (realMachine) {
          const shell = spawn('/bin/sh', [], { stdio: 'pipe' });
          stream.on('data', (chunk: Buffer) => shell.stdin.write(chunk.toString().replace(/\r/g, '\n')));
          shell.stdout.pipe(stream);
          shell.stderr.pipe(stream, { end: false });
          stream.on('close', () => shell.kill());
          shell.on('error', () => stream.end());
          return;
        }
        stream.write('fixture shell ready\r\n');
        stream.on('close', () => input.emit('shell-close'));
        stream.on('data', (chunk: Buffer) => { received.push(chunk.toString()); stream.write(chunk); input.emit('data'); });
      });
      session.on('exec', (accept, _reject, info) => {
        const stream = accept();
        if (realMachine) {
          const command = spawn('/bin/sh', ['-c', info.command], { stdio: 'pipe' });
          command.stdout.pipe(stream, { end: false });
          command.stderr.pipe(stream.stderr, { end: false });
          command.on('close', () => stream.end());
          command.on('error', () => stream.end());
          stream.on('close', () => command.kill());
          return;
        }
        stream.end('__SYSTEM__\nLinux fixture\n__UPTIME__\n1000 2000\n__CPU__\ncpu 10 0 10 80 0 0 0 0\n2\n__MEMORY__\nMemTotal: 1000 kB\nMemAvailable: 500 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n__LOAD__\n0.1 0.2 0.3\n__NETWORK__\neth0: 100 0 0 0 0 0 0 0 50 0\n__DISKS__\nFilesystem 1024-blocks Used Available Capacity Mounted on\n__PROCESSES__\nPID COMMAND %CPU %MEM\n');
      });
      session.on('sftp', accept => {
        const stream = accept();
        const { STATUS_CODE, OPEN_MODE } = ssh2.utils.sftp;
        const normalize = (path: string) => posix.resolve('/fixture', path);
        const handles = new Map<string, { path: string; listed?: boolean }>();
        const handle = (id: number, path: string) => {
          const key = String(id);
          handles.set(key, { path });
          stream.handle(id, Buffer.from(key));
        };
        const attrs = (data: Buffer | null) => ({ mode: data === null ? 0o40755 : 0o100644, uid: 1000, gid: 1000,
          size: data?.length ?? 0, mtime: 1, atime: 1 });
        stream.on('REALPATH', (id, path) => {
          const key = normalize(path);
          if (!files.has(key)) return stream.status(id, STATUS_CODE.NO_SUCH_FILE);
          stream.name(id, [{ filename: key, longname: key, attrs: attrs(files.get(key)!) }]);
        });
        stream.on('OPENDIR', (id, path) => {
          const key = normalize(path);
          if (files.get(key) !== null) return stream.status(id, STATUS_CODE.NO_SUCH_FILE);
          handle(id, key);
        });
        stream.on('READDIR', (id, raw) => {
          const dir = handles.get(raw.toString())!;
          if (dir.listed) return stream.status(id, STATUS_CODE.EOF);
          dir.listed = true;
          const children = [...files].filter(([path]) => path !== dir.path && posix.dirname(path) === dir.path);
          if (!children.length) return stream.status(id, STATUS_CODE.EOF);
          stream.name(id, children.map(([path, data]) => ({ filename: posix.basename(path), longname: path, attrs: attrs(data) })));
        });
        stream.on('OPEN', (id, path, flags) => {
          const key = normalize(path);
          if (flags & OPEN_MODE.CREAT) {
            if (files.has(key) && flags & OPEN_MODE.EXCL) return stream.status(id, STATUS_CODE.FAILURE);
            files.set(key, Buffer.alloc(0));
          }
          if (!Buffer.isBuffer(files.get(key))) return stream.status(id, STATUS_CODE.NO_SUCH_FILE);
          handle(id, key);
        });
        stream.on('READ', (id, raw, offset, length) => {
          const data = files.get(handles.get(raw.toString())!.path);
          if (!data || offset >= data.length) return stream.status(id, STATUS_CODE.EOF);
          stream.data(id, data.subarray(offset, offset + length));
        });
        stream.on('WRITE', (id, raw, offset, data) => {
          const path = handles.get(raw.toString())!.path;
          const before = files.get(path)!;
          const combined = Buffer.alloc(Math.max(before.length, offset + data.length));
          before.copy(combined); data.copy(combined, offset); files.set(path, combined);
          stream.status(id, STATUS_CODE.OK);
        });
        stream.on('FSTAT', (id, raw) => stream.attrs(id, attrs(files.get(handles.get(raw.toString())!.path)!)));
        for (const operation of ['STAT', 'LSTAT'] as const) stream.on(operation, (id: number, path: string) => {
          const key = normalize(path);
          if (!files.has(key)) return stream.status(id, STATUS_CODE.NO_SUCH_FILE);
          stream.attrs(id, attrs(files.get(key)!));
        });
        stream.on('MKDIR', (id, path) => {
          const key = normalize(path);
          if (files.has(key) || files.get(posix.dirname(key)) !== null) return stream.status(id, STATUS_CODE.FAILURE);
          files.set(key, null); stream.status(id, STATUS_CODE.OK);
        });
        stream.on('RENAME', (id, oldPath, newPath) => {
          const from = normalize(oldPath), to = normalize(newPath);
          if (!files.has(from) || files.has(to)) return stream.status(id, STATUS_CODE.FAILURE);
          for (const [key, data] of [...files]) if (key === from || key.startsWith(from + '/')) {
            files.delete(key); files.set(to + key.slice(from.length), data);
          }
          stream.status(id, STATUS_CODE.OK);
        });
        for (const operation of ['REMOVE', 'RMDIR'] as const) stream.on(operation, (id: number, path: string) => {
          const key = normalize(path);
          if (!files.has(key) || [...files.keys()].some(path => path.startsWith(key + '/'))) return stream.status(id, STATUS_CODE.FAILURE);
          files.delete(key); stream.status(id, STATUS_CODE.OK);
        });
        stream.on('CLOSE', (id, raw) => { handles.delete(raw.toString()); stream.status(id, STATUS_CODE.OK); });
      });
    }));
  });
  return { server: sshServer, fingerprint, received, input };
}
