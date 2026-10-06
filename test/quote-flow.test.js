'use strict';

// End-to-end cover for the path a customer actually walks: quote form in, lead
// out, confirmation page, and the admin-quote -> approve -> job handoff.
//
// It drives a real server process over HTTP rather than importing the app, so
// the thing under test is the thing that ships: middleware order, the bot
// filter, the rate limiter and the redirects all behave as they do on Render.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const ADMIN_PASSWORD = 'test-admin-password-123';

let server; // the child process
let base; // http://127.0.0.1:<port>
let dir; // throwaway data directory
let read; // read-only handle on the server's database

// ---------------------------------------------------------------- harness

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Resolves once the server prints its listen line, rejects if it dies first. */
function waitForListen(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in 15s')), 15000);
    let out = '';
    const onData = (chunk) => {
      out += chunk;
      if (out.includes('running on http://')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('server exited with ' + code + ':\n' + out));
    });
  });
}

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rydja-test-'));
  const dbPath = path.join(dir, 'app.db');
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;

  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      UPLOAD_DIR: path.join(dir, 'uploads'),
      BACKUP_DIR: path.join(dir, 'backups'),
      BACKUP_DAILY: '0', // no scheduled work during a test run
      NODE_ENV: 'test',
      ADMIN_PASSWORD,
      SESSION_SECRET: '9f1c4a7b2e6d08351c7a9be40d2f6a83cb5e17409d2a6b8c3f0e5172a4d6b9c8',
      BUSINESS_PHONE: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await waitForListen(server);
  read = new DatabaseSync(dbPath, { readOnly: true });
});

test.after(() => {
  try {
    read?.close();
  } catch {
    /* already gone */
  }
  server?.kill();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort — Windows may still hold the db file */
  }
});

// ---------------------------------------------------------------- helpers

const count = (table) => read.prepare('select count(*) as n from ' + table).get().n;

const get = (url, opts = {}) => fetch(base + url, { redirect: 'manual', ...opts });

const post = (url, fields, opts = {}) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) },
    body: new URLSearchParams(fields).toString()
  });

/** The signed stamp the server just issued for a fresh form. */
async function freshStamp() {
  const html = await (await get('/quote')).text();
  const m = html.match(/name="form_stamp" value="([^"]+)"/);
  assert.ok(m, 'quote form should carry a signed stamp');
  return m[1];
}

async function validSubmission(overrides = {}) {
  return {
    form_stamp: await freshStamp(),
    company_website: '',
    name: 'Dana Reed',
    phone: '6165550144',
    email: 'dana@example.com',
    zip: '49503',
    address: '12 Oak St',
    city: 'Grand Rapids',
    state: 'MI',
    service: 'Garage / basement cleanout',
    description: 'Two-car garage, boxes and an old couch. Everything goes.',
    access: 'Garage / barn',
    timing: 'ASAP',
    hazard_ack: '1',
    ...overrides
  };
}

/** Logged-in admin cookie header. */
async function adminCookie() {
  const res = await post('/admin/login', { password: ADMIN_PASSWORD });
  assert.equal(res.status, 302);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

// ---------------------------------------------------------------- tests

// This also covers the bug that prompted the fix: the stamp is fetched and
// posted back in the same instant, which the old three-second minimum treated
// as a bot and silently threw away.
test('a valid submission creates exactly one lead and lands on /quote/sent', async () => {
  assert.equal(count('leads'), 0);

  const res = await post('/quote', await validSubmission());

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/quote/sent');
  assert.equal(count('leads'), 1);
  assert.equal(count('customers'), 1);
});

test('submitting a quote request does not create a job', () => {
  assert.equal(count('jobs'), 0);
});

test('/quote/sent confirms the request and links home', async () => {
  const res = await get('/quote/sent');
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /Quote request sent/);
  assert.match(html, /We received your request/);
  assert.match(html, /href="\/"/);
});

test('the new lead shows up in /admin/leads', async () => {
  const cookie = await adminCookie();
  const res = await get('/admin/leads', { headers: { cookie } });
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /Dana Reed/);
  assert.match(html, /Garage \/ basement cleanout/);
});

test("the customer's private status link still works", async () => {
  const { public_token: token } = read.prepare('select public_token from leads order by id limit 1').get();
  const res = await get('/q/' + token);

  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Garage \/ basement cleanout/);
  assert.match(html, /Two-car garage, boxes and an old couch/);
});

test('a honeypot submission saves nothing and never looks like success', async () => {
  const before = count('leads');

  const res = await post(
    '/quote',
    await validSubmission({
      phone: '6165550199', // a would-be second customer
      company_website: 'http://spam.example'
    })
  );

  assert.equal(count('leads'), before, 'a rejected submission must not write a lead');
  assert.notEqual(res.status, 302, 'a rejection must not redirect like a saved request');
  assert.equal(res.status, 400);
  assert.doesNotMatch(await res.text(), /Quote request sent|We received your request/);
});

test('a forged form stamp is rejected', async () => {
  const before = count('leads');

  const res = await post(
    '/quote',
    await validSubmission({
      phone: '6165550177',
      form_stamp: 'deadbeef.notarealsignature'
    })
  );

  assert.equal(res.status, 400);
  assert.equal(count('leads'), before);
});

test('approving a quote creates the job, as before', async () => {
  const cookie = await adminCookie();
  const lead = read.prepare('select id, public_token from leads order by id limit 1').get();

  const quoted = await post(
    '/admin/leads/' + lead.id + '/quote',
    { amount: '450.00', notes: 'Two hours, one truck.' },
    { headers: { cookie } }
  );
  assert.equal(quoted.status, 302);

  const quote = read.prepare('select * from quotes where lead_id = ?').get(lead.id);
  assert.equal(quote.amount_cents, 45000);
  assert.equal(count('jobs'), 0, 'sending a quote alone must not create a job');

  const approved = await post('/q/' + lead.public_token + '/respond', { decision: 'approve' });
  assert.equal(approved.status, 302);

  assert.equal(count('jobs'), 1);
  const job = read.prepare('select * from jobs').get();
  assert.equal(job.lead_id, lead.id);
  assert.equal(job.customer_total_cents, 45000);
  assert.equal(job.status, 'unscheduled');
  assert.equal(read.prepare('select status from leads where id = ?').get(lead.id).status, 'converted');
});

// Last, because it fills the hourly window for this IP and anything after it
// would be blocked. The filler submissions trip the honeypot on purpose, so
// what is measured is the limiter, not lead writes.
test('the quote form is still rate limited', async () => {
  const before = count('leads');
  let blocked = null;

  for (let i = 0; i < 10 && !blocked; i++) {
    const res = await post('/quote', await validSubmission({ company_website: 'bot' }));
    if (res.status === 429) blocked = res;
  }

  assert.ok(blocked, 'the limiter should refuse a burst of submissions');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(count('leads'), before);
});
