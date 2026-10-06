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

// There is exactly one operator in V1: the owner. Jobs still reference it by
// id so contractors can be added later without touching the job model.
function ownerOperator() {
  let owner = db.prepare("select * from operators where role = 'owner' order by id limit 1").get();
  if (!owner) {
    const info = db.prepare('insert into operators (name, phone, email, role) values (?, ?, ?, ?)').run(
      process.env.OWNER_NAME || 'Owner',
      process.env.OWNER_PHONE || null,
      process.env.OWNER_EMAIL || null,
      'owner'
    );
    owner = db.prepare('select * from operators where id = ?').get(info.lastInsertRowid);
  }
  return owner;
}

ownerOperator();

module.exports = { db, ownerOperator, DB_PATH };
