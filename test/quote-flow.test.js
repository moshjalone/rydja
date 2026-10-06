'use strict';

// The path a customer actually walks: quote form in, lead out, confirmation
// page, and the admin-quote -> approve -> job handoff.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stampIssuedAt, freshStamp, submission } = require('./helpers');

let app;

test.before(async () => {
  app = await startServer();
});

test.after(() => app?.stop());

// ---------------------------------------------------------------- the form

test('the quote form carries a stamp and no decoy field', async () => {
  const html = await (await app.get('/quote')).text();

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
  assert.equal(app.count('leads'), 0);

  const res = await app.post('/quote', submission({ form_stamp: await freshStamp(app) }), { ip: '203.0.113.10' });

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/quote/sent');
  assert.equal(app.count('leads'), 1);
  assert.equal(app.count('customers'), 1);
});

test('submitting a quote request does not create a job', () => {
  assert.equal(app.count('jobs'), 0);
});

// The regression that started all this: a customer whose browser filled the
// form in and submitted it in well under a second. The stamp is minted at the
// instant of posting, so the submission is zero seconds old by construction —
// no dependence on how fast the machine running the tests happens to be.
test('an instant submission is accepted', async () => {
  const before = app.count('leads');

  const res = await app.post(
    '/quote',
    submission({ phone: '6165550155', form_stamp: stampIssuedAt(Date.now()) }),
    { ip: '203.0.113.11' }
  );

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/quote/sent');
  assert.equal(app.count('leads'), before + 1);
});

// Autofill cannot be rejected because there is nothing hidden left to reject
// on: extra fields a password manager might add are simply ignored.
test('autofilled extra fields cannot cause a rejection', async () => {
  const before = app.count('leads');

  const res = await app.post(
    '/quote',
    submission({
      phone: '6165550166',
      form_stamp: await freshStamp(app),
      company_website: 'https://autofilled-by-the-password-manager.example',
      organization: 'Reed Property LLC',
      url: 'https://example.com'
    }),
    { ip: '203.0.113.12' }
  );

  assert.equal(res.status, 302, 'the old honeypot name must no longer mean anything');
  assert.equal(res.headers.get('location'), '/quote/sent');
  assert.equal(app.count('leads'), before + 1);
});

test('/quote/sent confirms the request and links home', async () => {
  const res = await app.get('/quote/sent');
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /Quote request sent/);
  assert.match(html, /We received your request/);
  assert.match(html, /href="\/"/);
});

// ---------------------------------------------------------------- rejected

test('a forged stamp is rejected', async () => {
  const before = app.count('leads');

  const res = await app.post(
    '/quote',
    submission({ phone: '6165550177', form_stamp: 'deadbeef.notarealsignature' }),
    { ip: '203.0.113.13' }
  );

  assert.equal(res.status, 400);
  assert.equal(app.count('leads'), before);
  assert.doesNotMatch(await res.text(), /Quote request sent|We received your request/);
});

test('a missing stamp is rejected', async () => {
  const before = app.count('leads');

  const res = await app.post('/quote', submission({ phone: '6165550188' }), { ip: '203.0.113.14' });

  assert.equal(res.status, 400);
  assert.equal(app.count('leads'), before);
});

test('an expired stamp is rejected, and says so', async () => {
  const before = app.count('leads');
  const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000;

  const res = await app.post(
    '/quote',
    submission({ phone: '6165550199', form_stamp: stampIssuedAt(sevenHoursAgo) }),
    { ip: '203.0.113.15' }
  );
  const html = await res.text();

  assert.equal(res.status, 400);
  assert.equal(app.count('leads'), before);
  // A stale form is a different problem from a forged one, and the customer
  // is told which: re-send it, your details are still here.
  assert.match(html, /timed out/);
  assert.doesNotMatch(html, /Quote request sent|We received your request/);
});

// ---------------------------------------------------------------- admin flow

test('the new lead shows up in /admin/leads', async () => {
  const cookie = await app.adminCookie();
  const res = await app.get('/admin/leads', { headers: { cookie } });
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /Dana Reed/);
  assert.match(html, /Garage \/ basement cleanout/);
});

test("the customer's private status link still works", async () => {
  const { public_token: token } = app.read.prepare('select public_token from leads order by id limit 1').get();
  const res = await app.get('/q/' + token);
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /Garage \/ basement cleanout/);
  assert.match(html, /Two-car garage, boxes and an old couch/);
});

test('approving a quote creates the job, as before', async () => {
  const cookie = await app.adminCookie();
  const lead = app.read.prepare('select id, public_token from leads order by id limit 1').get();

  const quoted = await app.post(
    '/admin/leads/' + lead.id + '/quote',
    { amount: '450.00', notes: 'Two hours, one truck.' },
    { headers: { cookie }, ip: '203.0.113.99' }
  );
  assert.equal(quoted.status, 302);

  const quote = app.read.prepare('select * from quotes where lead_id = ?').get(lead.id);
  assert.equal(quote.amount_cents, 45000);
  assert.equal(app.count('jobs'), 0, 'sending a quote alone must not create a job');

  const approved = await app.post(
    '/q/' + lead.public_token + '/respond',
    { decision: 'approve' },
    { ip: '203.0.113.99' }
  );
  assert.equal(approved.status, 302);

  assert.equal(app.count('jobs'), 1);
  const job = app.read.prepare('select * from jobs').get();
  assert.equal(job.lead_id, lead.id);
  assert.equal(job.customer_total_cents, 45000);
  assert.equal(job.status, 'unscheduled');
  assert.equal(app.read.prepare('select status from leads where id = ?').get(lead.id).status, 'converted');
});

// ---------------------------------------------------------------- limits

// With the honeypot and the fill timer both gone, this is the one control left
// between the form and a flood, so it matters more than it did. Its own IP, so
// filling the hourly window here cannot affect any other test.
test('the quote form is still rate limited', async () => {
  const ip = '203.0.113.50';
  const before = app.count('leads');
  let blocked = null;
  let accepted = 0;

  for (let i = 0; i < 10 && !blocked; i++) {
    const res = await app.post('/quote', submission({ form_stamp: 'forged.sothisneverwrites' }), { ip });
    if (res.status === 429) blocked = res;
    else accepted++;
  }

  assert.ok(blocked, 'the limiter should refuse a burst of submissions');
  assert.equal(accepted, 5, 'five per hour, then 429');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal(app.count('leads'), before, 'none of the burst was written');
});
