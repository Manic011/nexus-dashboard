import { posix } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { SFTPWrapper, Stats } from 'ssh2';
import { z } from 'zod';
import { DiagnosticError } from './diagnostics.ts';

const path = z.string().min(1).max(4096).refine(value => !value.includes('\0'));
const name = z.string().min(1).max(255).refine(value => value !== '.' && value !== '..' && !/[\/\0]/.test(value));
const source = z.object({ directory: path, name });
const transferLimit = 4 * 1024 * 1024;
const operation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mkdir'), directory: path, name }),
  z.object({ action: z.literal('rename'), source, name }),
  z.object({ action: z.literal('delete'), source }),
  z.object({ action: z.enum(['copy', 'move']), source, directory: path }),
  z.object({ action: z.literal('download'), source }),
  z.object({ action: z.literal('upload'), directory: path, name, data: z.base64().max(Math.ceil(transferLimit / 3) * 4) }),
]);

function request<T>(start: (callback: (error: Error | null | undefined, value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => start((error, value) => error ? reject(error) : resolve(value)));
}

export async function fileOperation(sftp: SFTPWrapper, input: unknown, signal: AbortSignal) {
  const op = operation.parse(input);
  const realpath = (directory: string) => request<string>(cb => sftp.realpath(directory, cb));
  const stat = (target: string) => request<Stats>(cb => sftp.lstat(target, cb));
  const mkdir = (target: string) => request<void>(cb => sftp.mkdir(target, { mode: 0o700 }, cb));
  const remove = (target: string, directory: boolean) =>
    request<void>(cb => directory ? sftp.rmdir(target, cb) : sftp.unlink(target, cb));

  async function assertAvailable(target: string) {
    try { await stat(target); }
    catch (error) {
      if ((error as { code?: number }).code === 2) return;
      throw error;
    }
    throw new DiagnosticError(409, 'An item with that name already exists.');
  }

  async function write(target: string, data: Buffer | NodeJS.ReadableStream) {
    signal.throwIfAborted();
    const output = sftp.createWriteStream(target, { flags: 'wx', mode: 0o600 });
    let created = false;
    output.once('open', () => { created = true; });
    try { await pipeline(Buffer.isBuffer(data) ? [data] : data, output, { signal }); }
    catch (error) {
      if (created) await remove(target, false).catch(() => {});
      throw error;
    }
  }

  if (op.action === 'mkdir' || op.action === 'upload') {
    const destination = posix.join(await realpath(op.directory), op.name);
    await assertAvailable(destination);
    signal.throwIfAborted();
    if (op.action === 'mkdir') await mkdir(destination);
    else {
      const bytes = Buffer.from(op.data, 'base64');
      if (bytes.length > transferLimit) throw new DiagnosticError(413, 'Uploads are limited to 4 MiB.');
      await write(destination, bytes);
    }
    return {};
  }

  const parent = await realpath(op.source.directory);
  const target = posix.join(parent, op.source.name);
  const attributes = await stat(target);

  if (op.action === 'download') {
    if (!attributes.isFile()) throw new DiagnosticError(422, 'Select a regular file to download.');
    if (attributes.size > transferLimit) throw new DiagnosticError(413, 'Downloads are limited to 4 MiB.');
    const chunks: Buffer[] = [];
    const stream = sftp.createReadStream(target, { end: transferLimit });
    const abort = () => stream.destroy();
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      for await (const chunk of stream) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (bytes.length > transferLimit) throw new DiagnosticError(413, 'Downloads are limited to 4 MiB.');
      return { data: bytes.toString('base64') };
    } finally { signal.removeEventListener('abort', abort); stream.destroy(); }
  }

  const destination = op.action === 'delete' ? undefined : op.action === 'rename'
    ? posix.join(parent, op.name) : posix.join(await realpath(op.directory), op.source.name);
  if (destination) {
    if (destination === target || (attributes.isDirectory() && destination.startsWith(target + '/'))) {
      throw new DiagnosticError(400, 'Choose a destination outside the selected item.');
    }
    await assertAvailable(destination);
    if (op.action === 'move' || op.action === 'rename') {
      signal.throwIfAborted();
      await request<void>(cb => sftp.rename(target, destination, cb));
      return {};
    }
  }

  const items: { relative: string; attributes: Stats }[] = [];
  let bytes = 0;
  async function collect(relative: string, attrs: Stats, depth: number) {
    signal.throwIfAborted();
    if (depth > 32 || items.length >= 1000) throw new DiagnosticError(413, 'This folder exceeds the 1,000 item or 32 level operation limit.');
    if (destination && !attrs.isDirectory() && !attrs.isFile()) throw new DiagnosticError(422, 'Copy supports regular files and folders only.');
    if (attrs.isFile()) bytes += attrs.size;
    if (destination && bytes > 64 * 1024 * 1024) throw new DiagnosticError(413, 'Copy is limited to 64 MiB.');
    items.push({ relative, attributes: attrs });
    if (!attrs.isDirectory()) return;
    const entries = await readDirectory(posix.join(target, relative));
    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') continue;
      const child = posix.join(relative, name.parse(entry.filename));
      await collect(child, await stat(posix.join(target, child)), depth + 1);
    }
  }
  function readDirectory(targetPath: string) {
    return request<import('ssh2').FileEntry[]>(cb => sftp.readdir(targetPath, cb));
  }
  await collect('', attributes, 0);
  if (!destination) {
    for (const item of items.reverse()) {
      signal.throwIfAborted();
      await remove(posix.join(target, item.relative), item.attributes.isDirectory());
    }
    return {};
  }

  const created: { target: string; directory: boolean }[] = [];
  try {
    for (const item of items) {
      signal.throwIfAborted();
      const output = posix.join(destination, item.relative);
      const directory = item.attributes.isDirectory();
      if (directory) await mkdir(output);
      else {
        // Cap each stream at its observed size even if the source grows during the copy.
        const size = item.attributes.size;
        await write(output, size ? sftp.createReadStream(posix.join(target, item.relative), { end: size - 1 }) : Buffer.alloc(0));
      }
      created.push({ target: output, directory });
    }
  } catch (error) {
    for (const item of created.reverse()) await remove(item.target, item.directory).catch(() => {});
    throw error;
  }
  return {};
}
