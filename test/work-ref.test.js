'use strict';

// The permanent work reference: RYDJA-7K4M2Q.
//
// It is public, it is not a capability, and it follows one piece of work from
// the first request through to a finished job without ever changing.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, freshStamp, submission } = require('./helpers');

const REF = /^RYDJA-[23456789ABCDEFGHJKMNPQRSTWXYZ]{6}$/;

let app;

test.before(async () => {
  app = await startServer();
});

test.after(() => app?.stop());

async function createLead(fields, ip) {
  const res = await app.post('/quote', submission({ ...fields, form_stamp: await freshStamp(app) }), { ip });
  assert.equal(res.status, 302, 'the test lead should have been accepted');
  return app.read.prepare('select * from leads order by id desc limit 1').get();
}

// ---------------------------------------------------------------- format

test('a new lead is given a work reference', async () => {
  const lead = await createLead({}, '203.0.113.70');

  assert.ok(lead.work_ref, 'every lead gets one at creation');
  assert.match(lead.work_ref, REF);
});

test('the reference is not the database id, and leaks no sequence', async () => {
  const first = app.read.prepare('select * from leads order by id limit 1').get();
  const second = await createLead({ phone: '6165550201' }, '203.0.113.71');

  // The reference must not be the row id in any dress. Note what is NOT
  // asserted: that the id's digits are absent from the reference. "2" is in
  // the alphabet, so roughly one reference in five contains it by chance --
  // an earlier version of this test checked that and failed 19% of the time.
  const suffix = second.work_ref.split('-')[1];
  assert.notEqual(second.work_ref, String(second.id));
  assert.notEqual(suffix, String(second.id));
  assert.notEqual(suffix, String(second.id).padStart(6, '0'));
  assert.notEqual(Number(suffix), second.id);

  // Two consecutive rows must not produce adjacent references -- that is the
  // whole point of not exposing the primary key. A counter would change one
  // character and leave five alone; two random references agreeing in five of
  // six positions has a probability around 3e-7, so this is a real check
  // rather than a coin toss.
  assert.notEqual(first.work_ref, second.work_ref);
  assert.equal(second.id, first.id + 1, 'sanity: these really are consecutive rows');

  const a = first.work_ref.split('-')[1];
  let shared = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === suffix[i]) shared++;
  assert.ok(shared <= 4, `consecutive references look sequential: ${a} vs ${suffix}`);

  // And across the whole table they must not march in order.
  const inRowOrder = app.read.prepare('select work_ref from leads order by id').all().map((l) => l.work_ref);
  if (inRowOrder.length > 2) {
    const sorted = [...inRowOrder].sort();
    assert.notDeepEqual(inRowOrder, sorted, 'references must not ascend with the row id');
  }

  // The unambiguous alphabet: nothing that can be misheard or miswritten.
  for (const ref of app.read.prepare('select work_ref from leads').all().map((l) => l.work_ref)) {
    assert.doesNotMatch(ref.slice(6), /[01ILOUV]/, 'no confusable characters');
  }
});

test('references are unique across many leads', async () => {
  // Generated directly, so this exercises the generator and its collision
  // check rather than the rate limiter.
  const refs = new Set(app.read.prepare('select work_ref from leads').all().map((l) => l.work_ref));
  const before = refs.size;

  const insert = app.read; // read handle is read-only; use a second connection
  assert.ok(insert, 'sanity');

  // 300 generated references, all distinct and all well formed.
  const { generateWorkRef } = requireFreshDb();
  for (let i = 0; i < 300; i++) {
    const ref = generateWorkRef();
    assert.match(ref, REF);
    assert.ok(!refs.has(ref), 'generated a duplicate reference');
    refs.add(ref);
  }
  assert.equal(refs.size, before + 300);
});

/** A db module bound to its own throwaway file, for generator-level checks. */
function requireFreshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rydja-ref-'));
  const prev = process.env.DB_PATH;
  process.env.DB_PATH = path.join(dir, 'refs.db');
  delete require.cache[require.resolve('../db.js')];
  const mod = require('../db.js');
  process.env.DB_PATH = prev;
  return mod;
}

// ---------------------------------------------------------------- identity

test('the reference is not the private token', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();

  assert.notEqual(lead.work_ref, lead.public_token);
  assert.ok(!lead.public_token.includes(lead.work_ref));
  assert.ok(!lead.work_ref.includes(lead.public_token));
  assert.equal(lead.public_token.length, 32, 'the token is still 32 hex characters');
  assert.match(lead.public_token, /^[0-9a-f]{32}$/);
});

test('the reference alone opens nothing', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();

  // It is an identifier, not an authorization. Every shape of it is a 404.
  for (const guess of [lead.work_ref, lead.work_ref.split('-')[1], lead.work_ref.toLowerCase(), String(lead.id)]) {
    assert.equal((await app.get('/q/' + guess)).status, 404, guess + ' must not open a customer page');
  }

  // And the real token still does.
  assert.equal((await app.get('/q/' + lead.public_token)).status, 200);
});

// ---------------------------------------------------------------- lifecycle

test('a lead keeps one reference all the way through to a finished job', async () => {
  const lead = await createLead({ phone: '6165550202', email: 'dana@example.com' }, '203.0.113.72');
  const ref = lead.work_ref;
  const token = lead.public_token;
  assert.match(ref, REF);

  const cookie = await app.adminCookie();
  await app.post(
    '/admin/leads/' + lead.id + '/quote',
    { amount: '450.00', notes: 'Two hours.' },
    { headers: { cookie }, ip: '203.0.113.99' }
  );
  assert.equal(app.read.prepare('select work_ref from leads where id = ?').get(lead.id).work_ref, ref, 'quoting');

  await app.post('/q/' + token + '/respond', { decision: 'approve' }, { ip: '203.0.113.99' });
  const job = app.read.prepare('select * from jobs where lead_id = ?').get(lead.id);
  assert.ok(job, 'the approval created a job');

  // The job has no reference of its own to drift — it reads its lead's.
  const joined = app.read
    .prepare('select l.work_ref, l.public_token from jobs j join leads l on l.id = j.lead_id where j.id = ?')
    .get(job.id);
  assert.equal(joined.work_ref, ref, 'the job carries the requestreference, not a new number');
  assert.equal(joined.public_token, token, 'and the private token is untouched');

  // Through the rest of the lifecycle, too.
  for (const status of ['in_progress', 'complete']) {
    await app.post('/admin/jobs/' + job.id + '/status', { status }, { headers: { cookie }, ip: '203.0.113.99' });
    const still = app.read
      .prepare('select l.work_ref, l.public_token from jobs j join leads l on l.id = j.lead_id where j.id = ?')
      .get(job.id);
    assert.equal(still.work_ref, ref, 'reference survives ' + status);
    assert.equal(still.public_token, token, 'token survives ' + status);
  }
});

// ---------------------------------------------------------------- display

test('the reference is shown wherever the work is', async () => {
  const lead = app.read
    .prepare('select l.* from leads l join jobs j on j.lead_id = l.id order by j.id desc limit 1')
    .get();
  const job = app.read.prepare('select * from jobs where lead_id = ?').get(lead.id);
  const cookie = await app.adminCookie();

  const pages = [
    ['/q/' + lead.public_token, {}],
    ['/admin/leads', { cookie }],
    ['/admin/leads/' + lead.id, { cookie }],
    ['/admin/jobs', { cookie }],
    ['/admin/jobs/' + job.id, { cookie }]
  ];

  for (const [url, headers] of pages) {
    const html = await (await app.get(url, { headers })).text();
    assert.ok(html.includes(lead.work_ref), url + ' should show ' + lead.work_ref);
  }

  // The customer sees it labelled for where the work has got to.
  const customer = await (await app.get('/q/' + lead.public_token)).text();
  assert.match(customer, new RegExp('JOB ' + lead.work_ref));
  // ...and never a row id dressed up as a reference.
  assert.doesNotMatch(customer, /REQUEST \d+\b/);
});

// ---------------------------------------------------------------- migration

test('an existing database backfills without losing anything', async () => {
  // A database as it stood before this feature: no work_ref, no scheduling
  // columns, and a full set of related rows to prove nothing is disturbed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rydja-legacy-'));
  const dbPath = path.join(dir, 'legacy.db');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    pragma journal_mode = wal;
    create table operators (id integer primary key autoincrement, name text not null, phone text, email text,
      role text not null default 'owner', active integer not null default 1, created_at text not null default (datetime('now')));
    create table customers (id integer primary key autoincrement, name text not null, phone text not null unique,
      email text, created_at text not null default (datetime('now')));
    create table leads (id integer primary key autoincrement, customer_id integer not null references customers(id),
      public_token text not null unique, service text not null, description text not null, address text, city text,
      state text, zip text not null, access text, timing text, status text not null default 'new',
      created_at text not null default (datetime('now')));
    create table lead_photos (id integer primary key autoincrement, lead_id integer not null references leads(id),
      filename text not null, created_at text not null default (datetime('now')));
    create table quotes (id integer primary key autoincrement, lead_id integer not null references leads(id),
      amount_cents integer not null, notes text, status text not null default 'sent',
      created_at text not null default (datetime('now')), responded_at text);
    create table jobs (id integer primary key autoincrement, lead_id integer not null references leads(id),
      quote_id integer not null references quotes(id), operator_id integer not null references operators(id),
      status text not null default 'unscheduled', scheduled_for text, customer_total_cents integer not null,
      started_at text, completed_at text, created_at text not null default (datetime('now')));
    create table job_expenses (id integer primary key autoincrement, job_id integer not null references jobs(id),
      category text not null, amount_cents integer not null, weight_lbs real, note text,
      created_at text not null default (datetime('now')));
    create table salvage_items (id integer primary key autoincrement, job_id integer not null references jobs(id),
      title text not null, disposition text not null default 'resell', estimated_value_cents integer not null default 0,
      realized_value_cents integer, notes text, created_at text not null default (datetime('now')));
    create table job_photos (id integer primary key autoincrement, job_id integer not null references jobs(id),
      phase text not null, filename text not null, created_at text not null default (datetime('now')));

    insert into operators (name, role) values ('Owner', 'owner');
    insert into customers (name, phone, email) values ('Old Customer', '6165559000', 'old@example.com');
    insert into leads (customer_id, public_token, service, description, zip, status)
      values (1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Junk / hauling', 'An old converted lead.', '49503', 'converted');
    insert into leads (customer_id, public_token, service, description, zip, status)
      values (1, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Yard / brush cleanup', 'An old open lead.', '49503', 'new');
    insert into lead_photos (lead_id, filename) values (1, 'old-lead-photo.jpg');
    insert into quotes (lead_id, amount_cents, notes, status) values (1, 40000, 'Old quote notes.', 'approved');
    insert into jobs (lead_id, quote_id, operator_id, status, scheduled_for, customer_total_cents)
      values (1, 1, 1, 'complete', '2025-01-02 09:00', 40000);
    insert into job_expenses (job_id, category, amount_cents, weight_lbs) values (1, 'dump', 9000, 820.5);
    insert into salvage_items (job_id, title, disposition, estimated_value_cents, realized_value_cents)
      values (1, 'Old dresser', 'resell', 7000, 6500);
    insert into job_photos (job_id, phase, filename) values (1, 'before', 'old-before.jpg');
  `);
  legacy.close();

  // Boot the current app against it. The migration runs on the way up.
  const migrated = await startServer({ DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'uploads') });
  try {
    const leads = migrated.read.prepare('select * from leads order by id').all();
    assert.equal(leads.length, 2, 'both old leads survive');

    for (const lead of leads) {
      assert.match(lead.work_ref, REF, 'every old lead is given a reference');
    }
    assert.notEqual(leads[0].work_ref, leads[1].work_ref, 'and they are distinct');

    // Tokens are exactly as they were — an existing bookmark still works.
    assert.equal(leads[0].public_token, 'a'.repeat(32));
    assert.equal(leads[1].public_token, 'b'.repeat(32));
    assert.equal((await migrated.get('/q/' + 'a'.repeat(32))).status, 200, 'the old link still opens');

    // The existing job inherits its originating lead's reference.
    const job = migrated.read
      .prepare('select j.*, l.work_ref, l.public_token from jobs j join leads l on l.id = j.lead_id where j.id = 1')
      .get();
    assert.equal(job.work_ref, leads[0].work_ref, 'the job and its lead share one reference');
    assert.equal(job.lead_id, 1);
    assert.equal(job.status, 'complete');
    assert.equal(job.scheduled_for, '2025-01-02 09:00', 'an already-booked time is left alone');
    assert.equal(job.customer_total_cents, 40000);

    // The new scheduling columns exist and are empty, not guessed at.
    assert.equal(job.proposed_for, null);
    assert.equal(job.proposed_at, null);
    assert.equal(job.schedule_responded_at, null);
    assert.equal(job.schedule_message, null);

    // Nothing else moved.
    assert.equal(migrated.count('quotes'), 1);
    assert.equal(migrated.count('lead_photos'), 1);
    assert.equal(migrated.count('job_expenses'), 1);
    assert.equal(migrated.count('salvage_items'), 1);
    assert.equal(migrated.count('job_photos'), 1);
    assert.equal(migrated.read.prepare('select * from quotes where id = 1').get().notes, 'Old quote notes.');
    assert.equal(migrated.read.prepare('select * from job_expenses where id = 1').get().weight_lbs, 820.5);
    assert.equal(migrated.read.prepare('select * from salvage_items where id = 1').get().realized_value_cents, 6500);

    // The old job renders, reference and all.
    const cookie = await migrated.adminCookie();
    const page = await (await migrated.get('/admin/jobs/1', { headers: { cookie } })).text();
    assert.ok(page.includes(leads[0].work_ref));
  } finally {
    migrated.stop();
  }
});

test('migrating twice changes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rydja-twice-'));
  const dbPath = path.join(dir, 'twice.db');

  const first = await startServer({ DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'uploads') });
  let ref;
  try {
    const res = await first.post('/quote', submission({ form_stamp: await freshStamp(first) }), { ip: '203.0.113.73' });
    assert.equal(res.status, 302);
    ref = first.read.prepare('select work_ref from leads order by id desc limit 1').get().work_ref;
  } finally {
    first.stop();
  }

  const second = await startServer({ DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'uploads') });
  try {
    assert.equal(
      second.read.prepare('select work_ref from leads order by id desc limit 1').get().work_ref,
      ref,
      'a second boot must not reassign an existing reference'
    );
    assert.doesNotMatch(second.logs(), /\[migrate\]/, 'and must not re-run any migration step');
  } finally {
    second.stop();
  }
});
