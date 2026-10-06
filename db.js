'use strict';

// SQLite comes with Node (>= 22.5) via node:sqlite, so there is no native
// module to compile and nothing to install. The thin wrapper below gives us
// prepare().get/all/run and a transaction() helper.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const raw = new DatabaseSync(DB_PATH);
raw.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// node:sqlite rejects `undefined` parameters; treat it as SQL NULL.
const clean = (args) => args.map((a) => (a === undefined ? null : a));

const db = {
  exec: (sql) => raw.exec(sql),

  prepare(sql) {
    const stmt = raw.prepare(sql);
    return {
      get: (...args) => stmt.get(...clean(args)),
      all: (...args) => stmt.all(...clean(args)),
      run: (...args) => {
        const r = stmt.run(...clean(args));
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
      }
    };
  },

  /** transaction(fn) -> callable that runs fn inside BEGIN/COMMIT. */
  transaction(fn) {
    return (...args) => {
      raw.exec('begin');
      try {
        const out = fn(...args);
        raw.exec('commit');
        return out;
      } catch (err) {
        raw.exec('rollback');
        throw err;
      }
    };
  }
};

/** OWNER_* values, trimmed. Empty or unset means "no opinion". */
function ownerFromEnv() {
  return {
    name: (process.env.OWNER_NAME || '').trim(),
    phone: (process.env.OWNER_PHONE || '').trim(),
    email: (process.env.OWNER_EMAIL || '').trim()
  };
}

// There is exactly one operator in V1: the owner. Jobs still reference it by
// id so contractors can be added later without touching the job model.
function ownerOperator() {
  let owner = db.prepare("select * from operators where role = 'owner' order by id limit 1").get();
  if (!owner) {
    const env = ownerFromEnv();
    const info = db.prepare('insert into operators (name, phone, email, role) values (?, ?, ?, ?)').run(
      env.name || 'Owner',
      env.phone || null,
      env.email || null,
      'owner'
    );
    owner = db.prepare('select * from operators where id = ?').get(info.lastInsertRowid);
  }
  return owner;
}

/**
 * Keep the owner record in step with the environment on every boot, so OWNER_*
 * stays the source of truth and a value like the business email can be filled
 * in later without editing the database by hand.
 *
 * Deliberately narrow:
 *  - scoped to that one row by id, so contractors added later are never touched
 *  - an unset or empty variable leaves the stored value alone, so a dropped
 *    variable cannot silently blank out real contact details
 *  - writes only when something actually differs, so a normal boot is read-only
 */
function syncOwnerFromEnv() {
  const owner = ownerOperator();
  const env = ownerFromEnv();

  const fields = ['name', 'phone', 'email'].filter(
    (f) => env[f] && env[f] !== owner[f]
  );
  if (!fields.length) return owner;

  db.prepare(
    `update operators set ${fields.map((f) => f + ' = ?').join(', ')} where id = ?`
  ).run(...fields.map((f) => env[f]), owner.id);

  // Field names only — the values are the owner's personal contact details.
  console.log(`[operator] owner record synced from environment: ${fields.join(', ')}`);
  return db.prepare('select * from operators where id = ?').get(owner.id);
}

syncOwnerFromEnv();

module.exports = { db, ownerOperator, syncOwnerFromEnv, DB_PATH };
