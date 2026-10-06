'use strict';

// Backs up the database and every uploaded photo.
//
//   npm run backup              local snapshot, plus off-site if configured
//   npm run backup -- --local   local snapshot only
//
// The database is snapshotted with VACUUM INTO rather than a plain file copy.
// In WAL mode recent commits can still be sitting in app.db-wal, so copying
// app.db on its own can silently miss the newest leads. VACUUM INTO always
// writes a single consistent file.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');

const tar = require('./tar');
const { putObject, configFromEnv } = require('./s3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const BACKUP_ROOT = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const KEEP_LOCAL = Number(process.env.BACKUP_KEEP_LOCAL || 7);

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

/** 2026-10-06_14-32-10 — sorts chronologically, safe on every filesystem. */
const timestamp = () =>
  new Date().toISOString().replace(/\.\d+Z$/, '').replace('T', '_').replace(/:/g, '-');

/**
 * Timestamps only resolve to the second, so two runs in the same second would
 * collide — and VACUUM INTO refuses to write over an existing file rather than
 * overwrite a backup. Take the next free name instead of failing.
 */
function uniqueStamp() {
  const base = timestamp();
  let name = base;
  for (let n = 2; fs.existsSync(path.join(BACKUP_ROOT, name)); n++) name = `${base}-${n}`;
  return name;
}

/** A consistent single-file copy of the database. */
function snapshotDatabase(destFile) {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    db.exec(`vacuum into '${destFile.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

function listPhotos() {
  if (!fs.existsSync(UPLOAD_DIR)) return [];
  return fs
    .readdirSync(UPLOAD_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== '.gitkeep')
    .map((e) => e.name);
}

function rowCounts(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const n = (t) => db.prepare(`select count(*) c from ${t}`).get().c;
    return { leads: n('leads'), jobs: n('jobs'), customers: n('customers') };
  } finally {
    db.close();
  }
}

/** Keep the most recent N local snapshots; older ones are just disk usage. */
function pruneLocal() {
  if (!Number.isFinite(KEEP_LOCAL) || KEEP_LOCAL <= 0) return 0;
  const dirs = fs
    .readdirSync(BACKUP_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_/.test(e.name))
    .map((e) => e.name)
    .sort();

  let removed = 0;
  for (const name of dirs.slice(0, Math.max(0, dirs.length - KEEP_LOCAL))) {
    fs.rmSync(path.join(BACKUP_ROOT, name), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.localOnly] skip the off-site upload
 * @param {boolean} [opts.quiet]     no console output (used by the scheduler)
 */
async function runBackup(opts = {}) {
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);

  if (!fs.existsSync(DB_PATH)) throw new Error(`No database at ${DB_PATH}`);

  const stamp = uniqueStamp();
  const dest = path.join(BACKUP_ROOT, stamp);
  fs.mkdirSync(path.join(dest, 'uploads'), { recursive: true });

  // --- local snapshot ---------------------------------------------------
  const dbCopy = path.join(dest, 'app.db');
  snapshotDatabase(dbCopy);

  const photos = listPhotos();
  for (const name of photos) {
    fs.copyFileSync(path.join(UPLOAD_DIR, name), path.join(dest, 'uploads', name));
  }

  const counts = rowCounts(dbCopy);
  const dbBytes = fs.statSync(dbCopy).size;
  const photoBytes = photos.reduce((n, f) => n + fs.statSync(path.join(UPLOAD_DIR, f)).size, 0);

  log(`Backup ${stamp}`);
  log(`  app.db   ${mb(dbBytes)}  (${counts.leads} leads, ${counts.jobs} jobs, ${counts.customers} customers)`);
  log(`  uploads  ${photos.length} file(s), ${mb(photoBytes)}`);
  log(`  local    ${dest}`);

  const pruned = pruneLocal();
  if (pruned) log(`  pruned   ${pruned} old local snapshot(s), keeping ${KEEP_LOCAL}`);

  // --- off-site archive -------------------------------------------------
  const s3 = opts.localOnly ? null : configFromEnv();
  if (!s3) {
    log(
      opts.localOnly
        ? '  offsite  skipped (--local)'
        : '  offsite  NOT CONFIGURED — this backup is on the same disk as the original.'
    );
    return { stamp, dest, counts, offsite: null };
  }

  const entries = [
    { name: `${stamp}/app.db`, data: fs.readFileSync(dbCopy) },
    ...photos.map((name) => ({
      name: `${stamp}/uploads/${name}`,
      data: fs.readFileSync(path.join(UPLOAD_DIR, name))
    }))
  ];

  const archive = zlib.gzipSync(tar.create(entries), { level: 6 });
  const key = `${s3.prefix ? s3.prefix + '/' : ''}${stamp}.tar.gz`;

  const result = await putObject(s3, key, archive, 'application/gzip');
  log(`  offsite  ${s3.bucket}/${result.key}  ${mb(result.bytes)}`);

  return { stamp, dest, counts, offsite: result };
}

module.exports = { runBackup };

// Run directly from the CLI.
if (require.main === module) {
  runBackup({ localOnly: process.argv.includes('--local') })
    .then((r) => {
      if (!r.offsite) {
        console.log('\nCopy this folder somewhere off this machine — that is the whole business.');
      }
    })
    .catch((err) => {
      console.error('Backup FAILED:', err.message);
      process.exit(1);
    });
}
