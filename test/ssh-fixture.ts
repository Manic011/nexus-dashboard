import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export function createSshFixture(realMachine = false) {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const parsed = ssh2.utils.parseKey(key);
  assert.ok(!Array.isArray(parsed) && !(parsed instanceof Error));
  const fingerprint = 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '');
  const sshServer = new ssh2.Server({ hostKeys: [key] });
  const received: string[] = [];
  const input = new EventEmitter();
  sshServer.on('connection', client => {
    client.on('error', () => {});
    client.on('authentication', context => {
      if (context.method === 'password' && context.username === 'fixture' && context.password === 'fixture-password') context.accept();
      else context.reject();
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
        const { STATUS_CODE } = ssh2.utils.sftp;
        stream.on('REALPATH', (id: number) => stream.name(id, [{ filename: '/fixture', longname: '', attrs: { mode: 0o40755, uid: 1000, gid: 1000, size: 0, mtime: 1, atime: 1 } }]));
        stream.on('OPENDIR', (id: number) => stream.handle(id, Buffer.from('dir')));
        let listed = false;
        stream.on('READDIR', (id: number) => {
          if (listed) return stream.status(id, STATUS_CODE.EOF);
          listed = true;
          stream.name(id, [{ filename: 'hello.txt', longname: '', attrs: { mode: 0o100644, size: 5, mtime: 1, atime: 1, uid: 1000, gid: 1000 } }]);
        });
        stream.on('OPEN', (id: number) => stream.handle(id, Buffer.from('file')));
        stream.on('READ', (id: number, _handle: Buffer, offset: number) =>
          offset === 0 ? stream.data(id, Buffer.from('hello')) : stream.status(id, STATUS_CODE.EOF));
        stream.on('CLOSE', (id: number) => stream.status(id, STATUS_CODE.OK));
      });
    }));
  });
  return { server: sshServer, fingerprint, received, input };
}
