'use strict';

// Copies the database and every uploaded photo into backups/<timestamp>/.
// Run it with: npm run backup
//
// The database is snapshotted with VACUUM INTO rather than a plain file copy.
// In WAL mode recent commits can still be sitting in app.db-wal, so copying
// app.db on its own can silently miss the newest leads. VACUUM INTO always
// writes a single consistent file.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const BACKUP_ROOT = process.env.BACKUP_DIR || path.join(__dirname, 'backups');

// 2026-10-06_14-32-10 — sorts chronologically, safe on every filesystem.
const stamp = new Date()
  .toISOString()
  .replace(/\.\d+Z$/, '')
  .replace('T', '_')
  .replace(/:/g, '-');

const dest = path.join(BACKUP_ROOT, stamp);

function dirSize(dir) {
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) bytes += fs.statSync(path.join(dir, entry.name)).size;
  }
  return bytes;
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + ' MB';

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`No database at ${DB_PATH}. Nothing to back up.`);
    process.exit(1);
  }

  fs.mkdirSync(dest, { recursive: true });

  // --- database ---------------------------------------------------------
  const dbCopy = path.join(dest, 'app.db');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    db.exec(`vacuum into '${dbCopy.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  // --- photos -----------------------------------------------------------
  const photoDest = path.join(dest, 'uploads');
  fs.mkdirSync(photoDest, { recursive: true });

  let photoCount = 0;
  if (fs.existsSync(UPLOAD_DIR)) {
    for (const entry of fs.readdirSync(UPLOAD_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name === '.gitkeep') continue;
      fs.copyFileSync(path.join(UPLOAD_DIR, entry.name), path.join(photoDest, entry.name));
      photoCount++;
    }
  }

  // --- report -----------------------------------------------------------
  const counts = (() => {
    const snap = new DatabaseSync(dbCopy, { readOnly: true });
    try {
      const n = (t) => snap.prepare(`select count(*) c from ${t}`).get().c;
      return { leads: n('leads'), jobs: n('jobs'), customers: n('customers') };
    } finally {
      snap.close();
    }
  })();

  console.log(`Backup written to ${dest}`);
  console.log(`  app.db    ${mb(fs.statSync(dbCopy).size)}  (${counts.leads} leads, ${counts.jobs} jobs, ${counts.customers} customers)`);
  console.log(`  uploads   ${photoCount} file(s), ${mb(dirSize(photoDest))}`);
  console.log('\nCopy this folder somewhere off this machine — that is the whole business.');
}

main();
