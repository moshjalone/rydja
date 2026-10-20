'use strict';

// One job, from the quote form to the profit figure, in order, once.
//
// Every stage of this already has its own suite: quote-flow covers intake,
// business-notifications covers the mail, quote-scheduling covers the
// approve-and-confirm paths, admin-lists covers the lists. What none of them
// covers is the whole thing in sequence against one lead -- and the failures
// that only appear in sequence are the expensive ones: a reference that
// changes between stages, a status the dashboard disagrees with, a lead that
// becomes a job twice, money that counts differently on two pages.
//
// So this walks exactly one job the whole way:
//
//   quote form (with photos) -> the business is notified -> the lead is in the
//   inbox -> a quote with a proposed time goes out -> the customer approves and
//   confirms in one click -> the job is scheduled -> it starts -> expenses and
//   salvage go on -> it completes -> the dashboard and the job page agree about
//   what it was worth -> and the website's own funnel recorded the submission.
//
// Nothing here reaches the network: a local stub stands in for the mail
// provider, and the database is a throwaway.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, freshStamp, submission } = require('./helpers');

const SITE_URL = 'https://getrydja.com';
const BUSINESS_EMAIL = 'quotes@getrydja.com';
const CUSTOMER_EMAIL = 'dana@example.com';
const PHONE = '1-616-929-3360';
const ADMIN_IP = '203.0.113.99';
const CUSTOMER_IP = '198.51.100.77';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

let app;
let mailbox;
let cookie;

/** Stands in for api.resend.com. Records everything, reaches nothing. */
function startMailStub() {
  const sent = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      try {
        sent.push(JSON.parse(body));
      } catch {
        sent.push({ unparseable: body });
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"id":"stub-message-id"}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        sent,
        url: 'http://127.0.0.1:' + server.address().port,
        close: () => server.close()
      })
    );
  });
}

test.before(async () => {
  mailbox = await startMailStub();
  app = await startServer({
    SITE_URL,
    BUSINESS_EMAIL,
    EMAIL_FROM: 'RYDJA <quotes@getrydja.com>',
    BUSINESS_PHONE: PHONE,
    RESEND_API_KEY: 're_test_key_not_a_real_one',
    RESEND_API_BASE: mailbox.url
  });
  cookie = await app.adminCookie();
});

test.after(() => {
  app?.stop();
  mailbox?.close();
});

// A function, not a literal. `cookie` is assigned in test.before(), so an
// object built at module load would capture undefined and every admin post
// would quietly redirect to the login page -- a 302 either way, which is
// exactly the kind of green-looking failure a sequence test exists to catch.
const admin = () => ({ headers: { cookie }, ip: ADMIN_IP });
const one = (sql, ...args) => app.read.prepare(sql).get(...args);
const html = async (url, headers) => (await app.get(url, { headers })).text();
const settle = () => new Promise((r) => setTimeout(r, 100));

/** Everything a piece of mail could carry, as one searchable string. */
const bodyOf = (mail) => [mail.subject, mail.text, mail.html].filter(Boolean).join('\n');
const toBusiness = () => mailbox.sent.filter((m) => m.to.includes(BUSINESS_EMAIL));
const toCustomer = () => mailbox.sent.filter((m) => m.to.includes(CUSTOMER_EMAIL));

// The state this walk accumulates. Deliberately module-level: the point of
// the suite is the sequence, so each test depends on the one above it.
const state = {};

// ------------------------------------------------- 1. the customer asks

test('1. a customer on a phone sends a quote request with photos', async () => {
  // Measured the way a real browser would: the page reports a view and a form
  // start before the form is posted.
  await app.post('/api/event', { name: 'view', path: '/estate-cleanouts' }, {
    ip: CUSTOMER_IP,
    headers: { 'user-agent': IPHONE }
  });
  await app.post('/api/event', { name: 'quote_cta', path: '/estate-cleanouts' }, {
    ip: CUSTOMER_IP,
    headers: { 'user-agent': IPHONE }
  });
  await app.post('/api/event', { name: 'view', path: '/quote' }, {
    ip: CUSTOMER_IP,
    headers: { 'user-agent': IPHONE }
  });
  await app.post('/api/event', { name: 'form_start', path: '/quote' }, {
    ip: CUSTOMER_IP,
    headers: { 'user-agent': IPHONE }
  });

  // Two real photographs, posted as a browser would post them: multipart,
  // with the bytes of an actual PNG so the image sniffing accepts them.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64'
  );
  const form = new FormData();
  for (const [key, value] of Object.entries(
    submission({
      email: CUSTOMER_EMAIL,
      service: 'Estate / whole-property cleanout',
      description: 'Whole property. House, garage and a barn out the back. Everything goes except the piano.',
      estate_scope: 'Most of the property',
      estate_deadline: 'Has to be empty before the closing on the 14th'
    })
  )) {
    form.append(key, String(value));
  }
  form.append('estate_areas', 'House');
  form.append('estate_areas', 'Garage');
  form.append('estate_areas', 'Barn');
  form.append('form_stamp', await freshStamp(app));
  form.append('photos', new Blob([png], { type: 'image/png' }), 'garage.png');
  form.append('photos', new Blob([png], { type: 'image/png' }), 'barn.png');

  const res = await fetch(app.base + '/quote', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'x-forwarded-for': CUSTOMER_IP, 'user-agent': IPHONE },
    body: form
  });

  assert.equal(res.status, 302, 'the form should accept it');
  assert.equal(res.headers.get('location'), '/quote/sent');

  state.lead = one('select * from leads order by id desc limit 1');
  assert.ok(state.lead, 'a lead row exists');
  assert.equal(state.lead.status, 'new');
  assert.match(state.lead.work_ref, /^RYDJA-[0-9A-Z]{6}$/);
  assert.equal(state.lead.estate_areas, 'House, Garage, Barn');
  assert.equal(state.lead.estate_deadline, 'Has to be empty before the closing on the 14th');

  assert.equal(one('select count(*) as n from lead_photos where lead_id = ?', state.lead.id).n, 2,
    'both photographs are attached to the lead');

  // Exactly one lead, and no job: a request is not a commitment.
  assert.equal(one('select count(*) as n from leads').n, 1);
  assert.equal(one('select count(*) as n from jobs').n, 0);

  // And the confirmation page says plainly that it arrived.
  const sent = await html('/quote/sent');
  assert.match(sent, /<meta name="robots" content="noindex,nofollow">/, 'the confirmation is not indexable');
});

test('2. the business is notified once, with everything needed to act', async () => {
  assert.equal(toBusiness().length, 1, 'exactly one notification, never two');

  const note = toBusiness()[0];
  const body = bodyOf(note);

  assert.ok(body.includes(state.lead.work_ref), 'the reference is how the owner finds it');
  assert.ok(body.includes('Dana Reed'), 'the name');
  assert.ok(body.includes('Estate / whole-property cleanout'), 'the service');
  assert.ok(body.includes('Has to be empty before the closing on the 14th'), 'the deadline');
  assert.ok(body.includes('/admin/leads/' + state.lead.id), 'a link straight to the lead');

  // Reply-To goes to the customer, so answering the email answers them.
  assert.ok(JSON.stringify(note).includes(CUSTOMER_EMAIL), 'reply reaches the customer');

  // The private token must never be in an email to ourselves: that link is
  // the capability, and it belongs only to the customer.
  assert.ok(!body.includes(state.lead.public_token), 'the private token must not be in the notification');
});

test('3. nothing private reached the log', () => {
  const log = app.logs();

  // The reference and the source bucket are both public and identify nobody.
  assert.ok(log.includes(state.lead.work_ref), 'the reference is loggable, and useful');

  // These are not.
  for (const secret of ['Dana Reed', '6165550144', CUSTOMER_EMAIL, state.lead.public_token, '12 Oak St']) {
    assert.ok(!log.includes(secret), 'must never reach the log: ' + secret);
  }
});

// ------------------------------------------------- the owner acts

test('4. the lead is in the inbox, flagged as estate work', async () => {
  const doc = await html('/admin/leads', { cookie });

  assert.ok(doc.includes(state.lead.work_ref), 'the inbox shows the reference');
  assert.ok(doc.includes('href="/admin/leads/' + state.lead.id + '"'), 'and links the lead');
  assert.match(doc, /badge estate|class="badge estate"/, 'an estate lead is recognisable at a glance');

  const lead = await html('/admin/leads/' + state.lead.id, { cookie });
  assert.ok(lead.includes('House, Garage, Barn'), 'the estate answers are on the lead');
  assert.ok(lead.includes('closing on the 14th'), 'and the deadline');
  // The photographs the customer sent are reachable from the lead.
  const photos = app.read
    .prepare('select filename from lead_photos where lead_id = ?')
    .all(state.lead.id);
  for (const p of photos) {
    assert.ok(lead.includes(p.filename), 'the lead page shows the photograph ' + p.filename);
    assert.equal((await app.get('/uploads/' + p.filename)).status, 200, 'and it is served');
  }
});

test('5. the dashboard counts it, and says what is waiting', async () => {
  const doc = await html('/admin/dashboard', { cookie });

  assert.match(doc, /Leads<\/span><strong>1<\/strong>/, 'one lead this month');
  assert.match(doc, /Quotes sent<\/span><strong>0<\/strong>/, 'and no quote yet');
  assert.match(doc, /New leads without a quote/, 'the thing waiting is named');
});

test('6. a quote goes out with a proposed time, and reaches the customer', async () => {
  const when = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16).replace('T', ' ');
  state.proposedFor = when;

  const res = await app.post(
    '/admin/leads/' + state.lead.id + '/quote',
    { amount: '1850.00', notes: 'Three loads over two days. Barn included.', proposed_for: when },
    admin()
  );
  assert.equal(res.status, 302);

  state.quote = one('select * from quotes where lead_id = ? order by id desc limit 1', state.lead.id);
  assert.equal(state.quote.amount_cents, 185000);
  assert.equal(state.quote.status, 'sent');
  assert.ok(state.quote.proposed_for, 'the offered time is recorded against the quote');
  assert.equal(state.quote.terms_version, null, 'nothing is accepted until the customer accepts it');

  assert.equal(one('select status from leads where id = ?', state.lead.id).status, 'quoted');

  // The customer gets the price. One email, carrying their own link.
  assert.equal(toCustomer().length, 1, 'one email to the customer');
  const body = bodyOf(toCustomer()[0]);
  assert.ok(body.includes('1,850') || body.includes('1850'), 'the amount is in the email');
  assert.ok(body.includes(state.lead.work_ref), 'and the reference');
  assert.ok(body.includes(state.lead.public_token), 'and the link that opens their own page');
});

// ------------------------------------------------- the customer answers

test('7. the customer sees the price and the time together', async () => {
  const doc = await html('/q/' + state.lead.public_token);

  assert.ok(doc.includes(state.lead.work_ref), 'their reference is on their page');
  assert.ok(doc.includes('1,850'), 'the price');
  assert.match(doc, /<meta name="robots" content="noindex,nofollow">/, 'never indexable');
  assert.ok(!doc.includes('data-track'), 'and never measured');

  // One action that accepts both the price and the time.
  assert.match(doc, /name="decision" value="approve_confirm"/, 'approve-and-confirm in one click');
});

test('8. approving and confirming creates the job, scheduled, once', async () => {
  const res = await app.post(
    '/q/' + state.lead.public_token + '/respond',
    { decision: 'approve_confirm' },
    { ip: CUSTOMER_IP }
  );
  assert.equal(res.status, 302);

  state.job = one('select * from jobs where lead_id = ? order by id desc limit 1', state.lead.id);
  assert.ok(state.job, 'the job exists');
  assert.equal(state.job.status, 'scheduled');
  assert.ok(state.job.scheduled_for, 'a confirmed time is set');
  assert.equal(state.job.customer_total_cents, 185000, 'the job carries the approved price');

  const quote = one('select * from quotes where id = ?', state.quote.id);
  assert.equal(quote.status, 'approved');
  assert.ok(quote.responded_at, 'when they answered is recorded');
  assert.ok(quote.terms_version, 'and which Terms were in front of them when they did');

  assert.equal(one('select status from leads where id = ?', state.lead.id).status, 'converted');

  // A double click must not produce a second job. This is the check that
  // matters most in the whole flow.
  const again = await app.post(
    '/q/' + state.lead.public_token + '/respond',
    { decision: 'approve_confirm' },
    { ip: CUSTOMER_IP }
  );
  assert.equal(again.status, 302);
  assert.equal(one('select count(*) as n from jobs where lead_id = ?', state.lead.id).n, 1,
    'one approval, one job, however many times the button is pressed');
});

test('9. the owner is told the appointment is confirmed, not merely approved', () => {
  // The customer accepted the price and the time in one click, so the right
  // notification is "Appointment confirmed" with nothing left to do -- not
  // "Quote approved", which is the version that still needs a time proposing.
  // Telling those two apart is the whole point of the one-click path.
  const note = toBusiness()[toBusiness().length - 1];
  const body = bodyOf(note);

  assert.match(body, /Appointment confirmed/, 'the owner hears that it is booked');
  assert.match(body, /the time you proposed is booked/i, 'and that there is nothing to do');
  assert.ok(!/Propose (an)?other time/i.test(body), 'nothing is asked of the owner');

  assert.ok(body.includes(state.lead.work_ref), 'the reference is how he finds it');
  assert.ok(body.includes('$1,850.00'), 'and the amount');
  assert.ok(body.includes('/admin/jobs/' + state.job.id), 'and a link straight to the job');
  assert.ok(!body.includes(state.lead.public_token), 'still never the private token');
});

// ------------------------------------------------- the work

test('10. the job runs: started, costed, salvaged, completed', async () => {
  const jobUrl = '/admin/jobs/' + state.job.id;

  assert.equal((await app.post(jobUrl + '/status', { status: 'in_progress' }, admin())).status, 302);
  let job = one('select * from jobs where id = ?', state.job.id);
  assert.equal(job.status, 'in_progress');
  assert.ok(job.started_at, 'the start is stamped');

  // What it cost us.
  for (const expense of [
    { category: 'dump', amount: '240.00', weight_lbs: '3800', note: 'Three loads' },
    { category: 'fuel', amount: '68.50', note: '' },
    { category: 'helper', amount: '320.00', note: 'Two days, one helper' }
  ]) {
    assert.equal((await app.post(jobUrl + '/expenses', expense, admin())).status, 302);
  }
  assert.equal(one('select count(*) as n from job_expenses where job_id = ?', state.job.id).n, 3);

  // What came out of it that was worth something. Estimated first, then what
  // it actually sold for -- the two are different columns on purpose.
  assert.equal(
    (await app.post(jobUrl + '/salvage', {
      title: 'Cast-iron workbench vice',
      disposition: 'resell',
      estimated_value: '90.00',
      notes: ''
    }, admin())).status,
    302
  );
  const item = one('select * from salvage_items where job_id = ? order by id desc limit 1', state.job.id);
  assert.equal(item.estimated_value_cents, 9000);
  assert.equal(item.realized_value_cents, null, 'nothing is realized until it sells');

  assert.equal(
    (await app.post(jobUrl + '/salvage/' + item.id, { realized_value: '125.00' }, admin())).status,
    302
  );
  assert.equal(one('select realized_value_cents from salvage_items where id = ?', item.id).realized_value_cents, 12500);

  assert.equal((await app.post(jobUrl + '/status', { status: 'complete' }, admin())).status, 302);
  job = one('select * from jobs where id = ?', state.job.id);
  assert.equal(job.status, 'complete');
  assert.ok(job.completed_at, 'the completion is stamped');
});

test('11. the job page and the dashboard agree about what it was worth', async () => {
  // 185000 revenue - (24000 + 6850 + 32000) expenses + 12500 realized salvage.
  const expected = 185000 - 62850 + 12500;

  const jobDoc = await html('/admin/jobs/' + state.job.id, { cookie });
  const dashDoc = await html('/admin/dashboard', { cookie });

  const money = (cents) =>
    (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  assert.ok(jobDoc.includes(money(expected)), 'the job page shows ' + money(expected));
  assert.ok(dashDoc.includes(money(expected)), 'and so does the dashboard');

  // Two pages, one arithmetic. If these ever disagree, one of them is lying
  // about the month.
  assert.ok(dashDoc.includes(money(185000)), 'customer revenue');
  assert.ok(dashDoc.includes(money(62850)), 'recorded expenses');
  assert.ok(dashDoc.includes(money(12500)), 'realized salvage');

  assert.match(dashDoc, /Jobs completed<\/span><strong>1<\/strong>/);
});

test('12. the reference never changed, at any point in the whole flow', () => {
  const lead = one('select work_ref, public_token from leads where id = ?', state.lead.id);
  assert.equal(lead.work_ref, state.lead.work_ref, 'the reference a customer was given is permanent');
  assert.equal(lead.public_token, state.lead.public_token, 'and so is their link');

  // The reference is not the token, and never was. One is public and quotable
  // over the phone; the other is the key to the page.
  assert.notEqual(lead.work_ref, lead.public_token);
});

// ------------------------------------------------- what the website recorded

test('13. the website funnel recorded the job it actually produced', async () => {
  await settle();
  const doc = await html('/admin/traffic', { cookie });

  // The funnel's bottom step is the server-side counter, so it must be
  // exactly one -- the real submission, and not the forged attempts or the
  // double-clicked approval.
  const submits = one("select count(*) as n from visit_events where name = 'quote_submit'").n;
  assert.equal(submits, 1, 'one lead, one recorded submission');

  // And the steps above it, from the events the browser reported.
  for (const name of ['view', 'quote_cta', 'form_start']) {
    assert.ok(
      one('select count(*) as n from visit_events where name = ?', name).n >= 1,
      'the funnel should have recorded ' + name
    );
  }

  assert.match(doc, /Quote requests sent<\/span><strong>1<\/strong>/, 'the traffic page agrees');
  assert.match(doc, /Leads recorded<\/span><strong>1<\/strong>/, 'and so does the lead table');

  // Nothing about the customer is in the measurement tables. The lead is the
  // record of the customer; this is the record of the visit.
  const everything = JSON.stringify([
    ...app.read.prepare('select * from visit_events').all(),
    ...app.read.prepare('select * from crawler_visits').all()
  ]);
  for (const personal of ['Dana', '6165550144', CUSTOMER_EMAIL, CUSTOMER_IP,
                          state.lead.public_token, state.lead.work_ref, 'Oak St']) {
    assert.ok(!everything.includes(personal), 'measurement must not hold: ' + personal);
  }
});

test('14. nothing in the whole flow leaked a private URL into a public one', async () => {
  for (const path of ['/', '/quote', '/services', '/service-area', '/sitemap.xml',
                      '/junk-removal-lowell-mi', '/junk-removal-stanton-mi']) {
    const doc = await html(path);
    assert.ok(!doc.includes(state.lead.public_token), path + ' leaked the private token');
    assert.ok(!doc.includes('Dana Reed'), path + ' leaked a customer name');
    assert.ok(!doc.includes('/admin/leads/' + state.lead.id), path + ' leaked an admin URL');
  }
});
