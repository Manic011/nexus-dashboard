import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [archivePath, installerPath, ...rest] = process.argv.slice(2);
if (!archivePath || !installerPath || rest.length) {
  console.error('Usage: node deploy/make-installer.mjs RELEASE.tar.gz INSTALLER.sh');
  process.exit(1);
}

const archive = await readFile(archivePath);
if (archive[0] !== 0x1f || archive[1] !== 0x8b) throw new Error('Expected a gzip release archive.');
const digest = createHash('sha256').update(archive).digest('hex');
const template = await readFile(new URL('./bootstrap.sh', import.meta.url), 'utf8');
const header = template.replace(/\r\n/g, '\n').replace('@ARCHIVE_SHA256@', digest).trimEnd() + '\n';
const installer = Buffer.concat([Buffer.from(header), archive]);
await writeFile(installerPath, installer, { flag: 'wx', mode: 0o644 });
console.log(createHash('sha256').update(installer).digest('hex') + '  ' + installerPath);
