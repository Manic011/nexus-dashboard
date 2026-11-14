import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function validate(db: DatabaseSync) {
  const result = db.prepare('PRAGMA quick_check').get();
  if (result?.quick_check !== 'ok') throw new Error('Database integrity check failed.');
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
  if (version !== 4) throw new Error('This recovery tool requires a schema 4 database.');
  for (const table of ['accounts', 'sessions', 'tiles', 'access_groups', 'tile_access', 'admin_records']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error('Backup is missing required tables.');
  }
  if (!db.prepare("SELECT 1 FROM accounts WHERE role='admin'").get()) throw new Error('Backup has no administrator account.');
}

export async function backupState(source: string, destination: string) {
  if (existsSync(destination)) throw new Error('Backup destination already exists.');
  const db = new DatabaseSync(source, { readOnly: true });
  let created = false;
  try {
    validate(db);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    created = true;
    await backup(db, destination);
    chmodSync(destination, 0o600);
    const check = new DatabaseSync(destination, { readOnly: true });
    try { validate(check); } finally { check.close(); }
  } catch (error) {
    if (created) rmSync(destination, { force: true });
    throw error;
  } finally { db.close(); }
}

export async function restoreState(source: string, directory: string) {
  if (existsSync(directory) && readdirSync(directory).length) throw new Error('Restore requires a new or empty state directory.');
  const destination = join(directory, 'nexus.sqlite');
  await backupState(source, destination);
  const db = new DatabaseSync(destination);
  try {
    // Restoring account credentials must not reactivate sessions from the backup.
    db.exec('DELETE FROM sessions');
  } finally { db.close(); }
}

if (import.meta.main) {
  const [action, source, destination] = process.argv.slice(2);
  if (!source || !destination || !['backup', 'restore'].includes(action)) {
    console.error('Usage: node server/state-backup.ts backup SOURCE.sqlite DESTINATION.sqlite | restore BACKUP.sqlite EMPTY_STATE_DIRECTORY');
    process.exitCode = 1;
  } else {
    process.umask(0o077);
    try {
      await (action === 'backup' ? backupState(resolve(source), resolve(destination)) : restoreState(resolve(source), resolve(destination)));
      console.log(action === 'backup' ? 'Database backup verified. Protect this file: it contains authentication state.' : 'State restored to the new directory. Existing browser sessions were revoked.');
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Recovery failed.');
      process.exitCode = 1;
    }
  }
}
