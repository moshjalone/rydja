'use strict';

// SQLite comes with Node (>= 22.5) via node:sqlite, so there is no native
// module to compile and nothing to install. The thin wrapper below gives us
// prepare().get/all/run and a transaction() helper.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

// ---------------------------------------------------------------- work refs

// A fixed prefix, not BRAND_NAME. These references are permanent and get read
// out over the phone; a rebrand must not rewrite the ones already printed on a
// customer's page, and a database holding two different prefixes is worse than
// one holding a stale one.
const REF_PREFIX = 'RYDJA';

// No 0/O, 1/I/L, U/V confusion: every character survives being read aloud or
// written down badly. 30 characters, 6 of them, is 729 million references --
// far past anything this business will produce, and nowhere near sequential.
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTWXYZ';
const REF_LENGTH = 6;

/** RYDJA-7K4M2Q. Format only -- says nothing about whether it exists. */
const WORK_REF_PATTERN = new RegExp(`^${REF_PREFIX}-[${REF_ALPHABET}]{${REF_LENGTH}}$`);

function randomRef() {
  // rejection-free: 256 is not a multiple of 29, so take the modulo of bytes
  // drawn one at a time from a fresh pool. The bias is irrelevant here -- this
  // is an identifier, not a secret -- but crypto randomness costs nothing.
  const bytes = crypto.randomBytes(REF_LENGTH);
  let out = '';
  for (const b of bytes) out += REF_ALPHABET[b % REF_ALPHABET.length];
  return `${REF_PREFIX}-${out}`;
}

/**
 * A reference no lead is using yet. Collision-checked against the table rather
 * than trusted to probability.
 */
function generateWorkRef() {
  const taken = db.prepare('select 1 from leads where work_ref = ?');
  for (let i = 0; i < 50; i++) {
    const ref = randomRef();
    if (!taken.get(ref)) return ref;
  }
  // 50 collisions in a row means the keyspace is genuinely exhausted, which is
  // a problem no retry fixes. Fail loudly rather than hand back a duplicate.
  throw new Error('could not generate a unique work reference');
}

// ---------------------------------------------------------------- migrations

/**
 * Bring an existing database up to the current schema. `create table if not
 * exists` does nothing to a table that already exists, so new columns have to
 * be added by hand.
 *
 * Every step is guarded and additive: nothing is dropped, nothing is rewritten,
 * and running it twice is a no-op. Tokens, quotes, jobs, photos, expenses and
 * salvage rows are never touched.
 */
function migrate() {
  const columns = (table) =>
    new Set(db.prepare(`pragma table_info(${table})`).all().map((c) => c.name));

  const addColumn = (table, name, type) => {
    if (columns(table).has(name)) return false;
    db.exec(`alter table ${table} add column ${name} ${type}`);
    console.log(`[migrate] added ${table}.${name}`);
    return true;
  };

  addColumn('leads', 'work_ref', 'text');
  for (const col of ['proposed_for', 'proposed_at', 'schedule_responded_at', 'schedule_message']) {
    addColumn('jobs', col, 'text');
  }
  for (const col of ['pref_date_1', 'pref_window_1', 'pref_date_2', 'pref_window_2', 'scheduling_note',
                     'customer_message', 'customer_message_at']) {
    addColumn('leads', col, 'text');
  }
  addColumn('leads', 'scheduling_flexible', 'integer not null default 0');

  // Estate / whole-property detail. Additive and never backfilled: a lead
  // taken before these questions existed was not asked them, and guessing an
  // answer from the service alone would be a record of something the customer
  // never said. NULL reads as "not asked" in the admin.
  for (const col of ['estate_areas', 'estate_scope', 'estate_deadline']) {
    addColumn('leads', col, 'text');
  }

  // Lead attribution. Added without a backfill on purpose: a lead taken before
  // any of this existed has no source, and 'direct' would be a guess recorded
  // as a fact. NULL reads as Unknown in the admin and is excluded from every
  // conversion denominator, which is the honest answer.
  for (const col of ['source', 'utm_source', 'medium', 'campaign', 'content',
                     'term', 'referrer', 'landing_path']) {
    addColumn('leads', col, 'text');
  }
  db.exec('create index if not exists idx_leads_source on leads(source)');

  // Archiving, which is what the admin's "delete" actually does. NULL means
  // active. Nothing is ever removed: a lead carries photos, a job carries
  // expenses and salvage, and both are records of money. An archived row
  // drops out of the lists and out of every dashboard total, and can be
  // restored with one click.
  //
  // A job has its own flag but is also hidden by its lead's, so archiving a
  // lead takes its job with it without a second write that could disagree.
  addColumn('leads', 'archived_at', 'text');
  addColumn('jobs', 'archived_at', 'text');
  db.exec('create index if not exists idx_leads_archived on leads(archived_at)');
  db.exec('create index if not exists idx_jobs_archived on jobs(archived_at)');

  addColumn('quotes', 'proposed_for', 'text');
  // Deliberately not backfilled. A quote approved before the Terms existed did
  // not accept them, and writing a version into those rows would manufacture
  // consent that never happened.
  addColumn('quotes', 'terms_version', 'text');

  // Backfill before the unique index exists, so a half-migrated database with
  // several NULLs cannot trip over it on the way.
  const pending = db.prepare("select id from leads where work_ref is null or work_ref = ''").all();
  if (pending.length) {
    const assign = db.prepare('update leads set work_ref = ? where id = ?');
    db.transaction(() => {
      for (const row of pending) assign.run(generateWorkRef(), row.id);
    })();
    // A job inherits its lead's reference through lead_id, so backfilling the
    // lead is all it takes for existing jobs to pick theirs up.
    console.log(`[migrate] assigned work references to ${pending.length} existing lead(s)`);
  }

  db.exec('create unique index if not exists idx_leads_work_ref on leads(work_ref)');

  // One quote can only ever become one job. The handler guards this inside a
  // transaction, but a double-clicked Approve is exactly the case where a
  // guard in application code is the wrong place to put the guarantee.
  const duplicates = db
    .prepare('select quote_id, count(*) as n from jobs group by quote_id having n > 1')
    .all();
  if (duplicates.length) {
    // Never seen in practice; left as data rather than deleted behind the
    // owner's back, because a job carries expenses and photos.
    console.warn(
      `[migrate] ${duplicates.length} quote(s) have more than one job; skipping the unique index on jobs(quote_id)`
    );
  } else {
    db.exec('create unique index if not exists idx_jobs_quote on jobs(quote_id)');
  }
}

migrate();

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

module.exports = { db, ownerOperator, syncOwnerFromEnv, generateWorkRef, WORK_REF_PATTERN, DB_PATH };
