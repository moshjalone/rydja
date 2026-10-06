'use strict';

// End-to-end cover for the path a customer actually walks: quote form in, lead
// out, confirmation page, and the admin-quote -> approve -> job handoff.
//
// It drives a real server process over HTTP rather than importing the app, so
// the thing under test is the thing that ships: middleware order, the bot
// filter, the rate limiter and the redirects all behave as they do on Render.
//
// The server runs with TRUST_PROXY=1, as it does in production, so each test
// can present its own X-Forwarded-For and get its own rate-limit bucket. That
// keeps the tests independent of each other and of their order.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const ADMIN_PASSWORD = 'test-admin-password-123';
const SESSION_SECRET = '9f1c4a7b2e6d08351c7a9be40d2f6a83cb5e17409d2a6b8c3f0e5172a4d6b9c8';

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
      TRUST_PROXY: '1', // one proxy hop, as on Render
      ADMIN_PASSWORD,
      SESSION_SECRET,
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

/** `ip` picks the rate-limit bucket, so each test can have one to itself. */
const post = (url, fields, opts = {}) =>
  fetch(base + url, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-for': opts.ip || '203.0.113.1',
      ...(opts.headers || {})
    },
    body: new URLSearchParams(fields).toString()
  });

/**
 * The same stamp the server issues, built here so a test can choose the issue
 * time — the only way to exercise expiry without waiting six hours.
 */
function stampIssuedAt(ms) {
  const issued = Math.floor(ms).toString(36);
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(issued).digest('base64url').slice(0, 16);
  return issued + '.' + sig;
}

/** The stamp the live form is carrying right now. */
async function freshStamp() {
  const html = await (await get('/quote')).text();
  const m = html.match(/name="form_stamp" value="([^"]+)"/);
  assert.ok(m, 'quote form should carry a signed stamp');
  return m[1];
}

function submission(overrides = {}) {
  return {
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
  const res = await post('/admin/login', { password: ADMIN_PASSWORD }, { ip: '203.0.113.99' });
  assert.equal(res.status, 302);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

// ---------------------------------------------------------------- the form

test('the quote form carries a stamp and no decoy field', async () => {
  const html = await (await get('/quote')).text();

  // The stamp is the only hidden input. Anything else hidden in this form is
  // something a password manager could fill in without the customer knowing —
  // which is exactly how the honeypot rejected a real submission.
  const hidden = html.match(/<input[^>]*type="hidden"[^>]*>/g) || [];
  assert.equal(hidden.length, 1);
  assert.match(hidden[0], /name="form_stamp"/);

  assert.doesNotMatch(html, /company_website/, 'the honeypot field must be gone');
  assert.doesNotMatch(html, /class="nope"/, 'the off-screen decoy wrapper must be gone');
  assert.doesNotMatch(html, /aria-hidden/, 'the form must not hide inputs from assistive tech');
});

// ---------------------------------------------------------------- accepted

test('a normal submission creates exactly one lead and lands on /quote/sent', async () => {
  assert.equal(count('leads'), 0);

  const res = await post('/quote', submission({ form_stamp: await freshStamp() }), { ip: '203.0.113.10' });

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/quote/sent');
  assert.equal(count('leads'), 1);
  assert.equal(count('customers'), 1);
});

test('submitting a quote request does not create a job', () => {
  assert.equal(count('jobs'), 0);
});

// The regression that started all this: a customer whose browser filled the
// form in and submitted it in well under a second. The stamp is minted at the
// instant of posting, so the submission is zero seconds old by construction —
// no dependence on how fast the machine running the tests happens to be.
test('an instant submission is accepted', async () => {
  const before = count('leads');

  const res = await post(
    '/quote',
    submission({ phone: '6165550155', form_stamp: stampIssuedAt(Date.now()) }),
    { ip: '203.0.113.11' }
  );

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/quote/sent');
  assert.equal(count('leads'), before + 1);
});

// Autofill cannot be rejected because there is nothing hidden left to reject
// on: extra fields a password manager might add are simply ignored.
test('autofilled extra fields cannot cause a rejection', async () => {
  const before = count('leads');

  const res = await post(
    '/quote',
    submission({
      phone: '6165550166',
      form_stamp: await freshStamp(),
      company_website: 'https://autofilled-by-the-password-manager.example',
      organization: 'Reed Property LLC',
      url: 'https://example.com'
    }),
    { ip: '203.0.113.12' }
  );

  assert.equal(res.status, 302, 'the old honeypot name must no longer mean anything');
  assert.equal(res.headers.get('location'), '/quote/sent');
  assert.equal(count('leads'), before + 1);
});

test('/quote/sent confirms the request and links home', async () => {
  const res = await get('/quote/sent');
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /Quote request sent/);
  assert.match(html, /We received your request/);
  assert.match(html, /href="\/"/);
});

// ---------------------------------------------------------------- rejected

test('a forged stamp is rejected', async () => {
  const before = count('leads');

  const res = await post(
    '/quote',
    submission({ phone: '6165550177', form_stamp: 'deadbeef.notarealsignature' }),
    { ip: '203.0.113.13' }
  );

  assert.equal(res.status, 400);
  assert.equal(count('leads'), before);
  assert.doesNotMatch(await res.text(), /Quote request sent|We received your request/);
});

test('a missing stamp is rejected', async () => {
  const before = count('leads');

  const res = await post('/quote', submission({ phone: '6165550188' }), { ip: '203.0.113.14' });

  assert.equal(res.status, 400);
  assert.equal(count('leads'), before);
});

test('an expired stamp is rejected, and says so', async () => {
  const before = count('leads');
  const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000;

  const res = await post(
    '/quote',
    submission({ phone: '6165550199', form_stamp: stampIssuedAt(sevenHoursAgo) }),
    { ip: '203.0.113.15' }
  );
  const html = await res.text();

  assert.equal(res.status, 400);
  assert.equal(count('leads'), before);
  // A stale form is a different problem from a forged one, and the customer
  // is told which: re-send it, your details are still here.
  assert.match(html, /timed out/);
  assert.doesNotMatch(html, /Quote request sent|We received your request/);
});

// ---------------------------------------------------------------- admin flow

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

test('approving a quote creates the job, as before', async () => {
  const cookie = await adminCookie();
  const lead = read.prepare('select id, public_token from leads order by id limit 1').get();

  const quoted = await post(
    '/admin/leads/' + lead.id + '/quote',
    { amount: '450.00', notes: 'Two hours, one truck.' },
    { headers: { cookie }, ip: '203.0.113.99' }
  );
  assert.equal(quoted.status, 302);

  const quote = read.prepare('select * from quotes where lead_id = ?').get(lead.id);
  assert.equal(quote.amount_cents, 45000);
  assert.equal(count('jobs'), 0, 'sending a quote alone must not create a job');

  const approved = await post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.99' });
  assert.equal(approved.status, 302);

  assert.equal(count('jobs'), 1);
  const job = read.prepare('select * from jobs').get();
  assert.equal(job.lead_id, lead.id);
  assert.equal(job.customer_total_cents, 45000);
  assert.equal(job.status, 'unscheduled');
  assert.equal(read.prepare('select status from leads where id = ?').get(lead.id).status, 'converted');
});

// ---------------------------------------------------------------- limits

// With the honeypot and the fill timer both gone, this is the one control left
// between the form and a flood, so it matters more than it did. Its own IP, so
// filling the hourly window here cannot affect any other test.
test('the quote form is still rate limited', async () => {
  const ip = '203.0.113.50';
  const before = count('leads');
  let blocked = null;
  let accepted = 0;

  for (let i = 0; i < 10 && !blocked; i++) {
    const res = await post('/quote', submission({ form_stamp: 'forged.sothisneverwrites' }), { ip });
    if (res.status === 429) blocked = res;
    else accepted++;
  }

  assert.ok(blocked, 'the limiter should refuse a burst of submissions');
  assert.equal(accepted, 5, 'five per hour, then 429');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(count('leads'), before, 'none of the burst was written');
});
