'use strict';

// Notifications to ourselves.
//
// Every customer-driven event that needs a human sends one email to
// BUSINESS_EMAIL. What is tested here is mostly what must NOT happen: no
// duplicate on a double click, no private token in the body, no PII in the
// log, and above all no database change undone because a provider was down.
//
// A local stub stands in for Resend, so the real fetch, the real body and the
// real failure handling are exercised without reaching the network.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, freshStamp, submission } = require('./helpers');

const SITE_URL = 'https://getrydja.com';
const BUSINESS_EMAIL = 'quotes@getrydja.com';
const EMAIL_FROM = 'RYDJA <quotes@getrydja.com>';
const CUSTOMER_EMAIL = 'dana@example.com';
const ESTATE_SERVICE = 'Estate / whole-property cleanout';

let app;
let mailbox;
let cookie;

// ---------------------------------------------------------------- stub

/** Stands in for api.resend.com, and can be told to fail. */
function startMailStub() {
  const sent = [];
  let reply = { status: 200, body: '{"id":"stub-message-id"}' };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      let parsed = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = { unparseable: body };
      }
      sent.push(parsed);
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(reply.body);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        sent,
        url: 'http://127.0.0.1:' + server.address().port,
        /** Make every send fail the way a provider would. */
        failWith: (status) => {
          reply = { status, body: '{"message":"nope"}' };
        },
        succeed: () => {
          reply = { status: 200, body: '{"id":"stub-message-id"}' };
        },
        close: () => server.close()
      });
    });
  });
}

test.before(async () => {
  mailbox = await startMailStub();
  app = await startServer({
    SITE_URL,
    BUSINESS_EMAIL,
    EMAIL_FROM,
    BUSINESS_PHONE: '1-616-929-3360',
    RESEND_API_KEY: 're_test_key_not_a_real_one',
    RESEND_API_BASE: mailbox.url
  });
  cookie = await app.adminCookie();
});

test.after(() => {
  app?.stop();
  mailbox?.close();
});

// ---------------------------------------------------------------- helpers

/** Only the mail addressed to us. */
const notes = () => mailbox.sent.filter((m) => m.to.includes(BUSINESS_EMAIL));
const lastNote = () => notes()[notes().length - 1];
const noteCount = () => notes().length;

/** Everything a notification could carry, as one string. */
const bodyOf = (mail) => [mail.subject, mail.text, mail.html].join('\n');

/**
 * Repeated name/value pairs, the way a browser posts a checkbox group. A
 * URLSearchParams object would flatten ['House','Barn'] to one comma-joined
 * value, which the server correctly refuses.
 */
function pairs(fields) {
  const out = [];
  for (const [key, value] of Object.entries(fields)) {
    for (const one of [].concat(value)) out.push([key, String(one)]);
  }
  return out;
}

async function newLead(phone, ip, extra = {}) {
  const body = pairs({ ...submission({ phone, email: CUSTOMER_EMAIL, ...extra }), form_stamp: await freshStamp(app) });
  const res = await app.post('/quote', body, { ip });
  assert.equal(res.status, 302, 'the form should have accepted it');
  return app.read.prepare('select * from leads order by id desc limit 1').get();
}

const sendQuote = (leadId, amount, extra = {}) =>
  app.post(
    '/admin/leads/' + leadId + '/quote',
    { amount, notes: '', ...extra },
    { headers: { cookie }, ip: '203.0.113.99' }
  );

const propose = (jobId, when) =>
  app.post(
    '/admin/jobs/' + jobId + '/propose',
    { proposed_for: when },
    { headers: { cookie }, ip: '203.0.113.99' }
  );

const jobFor = (leadId) =>
  app.read.prepare('select * from jobs where lead_id = ? order by id desc limit 1').get(leadId);

// ---------------------------------------------------------------- new lead

test('a new quote request sends exactly one notification to the business', async () => {
  const before = noteCount();
  const lead = await newLead('6165550201', '203.0.113.60');

  assert.equal(noteCount(), before + 1, 'exactly one notification');

  const mail = lastNote();
  assert.deepEqual(mail.to, [BUSINESS_EMAIL], 'addressed to the business');
  assert.equal(mail.from, EMAIL_FROM);
  assert.equal(mail.subject, 'New quote request — ' + lead.work_ref);
});

test('the notification carries what is needed to act on the lead', async () => {
  const mail = lastNote();
  const body = bodyOf(mail);
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();

  assert.match(body, /New quote request/);
  assert.ok(body.includes(lead.work_ref), 'the work reference');
  assert.ok(body.includes('6165550201'), 'the phone number');
  assert.ok(body.includes(CUSTOMER_EMAIL), 'the email address');
  assert.ok(body.includes(SITE_URL + '/admin/leads/' + lead.id), 'the admin link');
});

test('Reply goes to the customer on a new request', async () => {
  assert.equal(lastNote().reply_to, CUSTOMER_EMAIL);
});

test('a request with no email address still notifies, replying to us', async () => {
  const before = noteCount();
  const res = await app.post(
    '/quote',
    pairs({ ...submission({ phone: '6165550202', email: '' }), form_stamp: await freshStamp(app) }),
    { ip: '203.0.113.61' }
  );
  assert.equal(res.status, 302);

  assert.equal(noteCount(), before + 1);
  assert.equal(lastNote().reply_to, BUSINESS_EMAIL, 'nothing to reply to, so it comes back to us');
});

test('an estate request carries the estate answers', async () => {
  const lead = await newLead('6165550203', '203.0.113.62', {
    service: ESTATE_SERVICE,
    estate_areas: ['House', 'Barn'],
    estate_scope: 'Whole property / multiple buildings',
    estate_deadline: 'Before the closing on the 14th'
  });

  const body = bodyOf(lastNote());
  assert.ok(body.includes(lead.work_ref));
  assert.match(body, /Estate scope/, 'the estate scope is labelled');
  assert.ok(body.includes('Whole property / multiple buildings'), 'and present');
  assert.ok(body.includes('House'), 'the areas');
  assert.ok(body.includes('Before the closing on the 14th'), 'the deadline');
});

test('a non-estate request carries no estate rows at all', async () => {
  await newLead('6165550204', '203.0.113.63');
  const body = bodyOf(lastNote());
  assert.doesNotMatch(body, /Estate scope/);
  assert.doesNotMatch(body, /Estate areas/);
  assert.doesNotMatch(body, /Estate deadline/);
});

test('preferred dates and the photo count are included when given', async () => {
  const lead = await newLead('6165550205', '203.0.113.64', {
    preferred_date_1: futureDate(10),
    preferred_window_1: 'morning'
  });

  const body = bodyOf(lastNote());
  assert.ok(body.includes(lead.work_ref));
  assert.match(body, /Preferred/, 'the preferred date is labelled');
  assert.match(body, /Morning/i, 'with its window');
  assert.match(body, /Photos/, 'and a photo count');
});

/** A date the server will accept: real, future, inside a year. */
function futureDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

// ---------------------------------------------------------------- question

test('a customer question notifies the business', async () => {
  const lead = await newLead('6165550206', '203.0.113.65');
  await sendQuote(lead.id, '450.00');

  const before = noteCount();
  await app.post('/q/' + lead.public_token + '/ask', { question: 'Can you take a piano?' }, { ip: '203.0.113.65' });

  assert.equal(noteCount(), before + 1);
  const mail = lastNote();
  assert.equal(mail.subject, 'Customer question — ' + lead.work_ref);
  assert.ok(bodyOf(mail).includes('Can you take a piano?'), 'their words');
  assert.ok(bodyOf(mail).includes(SITE_URL + '/admin/leads/' + lead.id), 'the admin link');
  assert.equal(mail.reply_to, CUSTOMER_EMAIL, 'they asked something, so Reply reaches them');
});

test('asking the same question twice notifies once', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  const before = noteCount();

  await app.post('/q/' + lead.public_token + '/ask', { question: 'Can you take a piano?' }, { ip: '203.0.113.65' });

  assert.equal(noteCount(), before, 'the repeat sends nothing');
});

// ---------------------------------------------------------------- decisions

test('declining a quote notifies, and points at the lead', async () => {
  const lead = await newLead('6165550207', '203.0.113.66');
  await sendQuote(lead.id, '450.00');

  const before = noteCount();
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'decline' }, { ip: '203.0.113.66' });

  assert.equal(noteCount(), before + 1);
  const mail = lastNote();
  assert.equal(mail.subject, 'Quote declined — ' + lead.work_ref);
  // A declined quote never became a job.
  assert.ok(bodyOf(mail).includes(SITE_URL + '/admin/leads/' + lead.id));
  assert.equal(mail.reply_to, BUSINESS_EMAIL, 'a status event replies to us');
});

test('approving a quote with no proposed time notifies and asks for one', async () => {
  const lead = await newLead('6165550208', '203.0.113.67');
  await sendQuote(lead.id, '450.00');

  const before = noteCount();
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.67' });

  assert.equal(noteCount(), before + 1);
  const mail = lastNote();
  assert.equal(mail.subject, 'Quote approved — ' + lead.work_ref);
  assert.match(bodyOf(mail), /Propose one/, 'it says what to do next');
  assert.ok(bodyOf(mail).includes(SITE_URL + '/admin/jobs/' + jobFor(lead.id).id), 'and links the job');
});

test('approving twice notifies once', async () => {
  const lead = await newLead('6165550209', '203.0.113.68');
  await sendQuote(lead.id, '450.00');

  const before = noteCount();
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.68' });
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.68' });

  assert.equal(noteCount(), before + 1, 'the second click announces nothing');
});

test('approving and confirming the offered time notifies as a confirmation', async () => {
  const lead = await newLead('6165550210', '203.0.113.69');
  await sendQuote(lead.id, '450.00', { proposed_for: '2026-11-20 09:00' });

  const before = noteCount();
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve_confirm' }, { ip: '203.0.113.69' });

  assert.equal(noteCount(), before + 1);
  const mail = lastNote();
  assert.equal(mail.subject, 'Appointment confirmed — ' + lead.work_ref);
  assert.match(bodyOf(mail), /Nothing to do/, 'it says no action is needed');
});

test('approving but asking for another time notifies, and replies to them', async () => {
  const lead = await newLead('6165550211', '203.0.113.70');
  await sendQuote(lead.id, '450.00', { proposed_for: '2026-11-20 09:00' });

  const before = noteCount();
  await app.post(
    '/q/' + lead.public_token + '/respond',
    { decision: 'approve_change', message: 'Mornings are hard for me.' },
    { ip: '203.0.113.70' }
  );

  assert.equal(noteCount(), before + 1);
  const mail = lastNote();
  assert.equal(mail.subject, 'Customer requested a different time — ' + lead.work_ref);
  assert.ok(bodyOf(mail).includes('Mornings are hard for me.'), 'their words');
  assert.equal(mail.reply_to, CUSTOMER_EMAIL, 'they asked for something');
});

// ---------------------------------------------------------------- scheduling

test('accepting a proposed time notifies the business', async () => {
  const lead = await newLead('6165550212', '203.0.113.71');
  await sendQuote(lead.id, '450.00');
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.71' });
  await propose(jobFor(lead.id).id, '2026-12-02 13:00');

  const before = noteCount();
  await app.post('/q/' + lead.public_token + '/schedule', { decision: 'accept' }, { ip: '203.0.113.71' });

  assert.equal(noteCount(), before + 1);
  const mail = lastNote();
  assert.equal(mail.subject, 'Appointment confirmed — ' + lead.work_ref);
  assert.ok(bodyOf(mail).includes(SITE_URL + '/admin/jobs/' + jobFor(lead.id).id));
  assert.equal(jobFor(lead.id).status, 'scheduled');
});

test('accepting twice notifies once, and the booking stands', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  const before = noteCount();

  await app.post('/q/' + lead.public_token + '/schedule', { decision: 'accept' }, { ip: '203.0.113.71' });

  assert.equal(noteCount(), before, 'the repeat sends nothing');
  assert.equal(jobFor(lead.id).status, 'scheduled', 'and changes nothing');
});

test('a customer can still accept a freshly proposed time after one was booked', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  await propose(jobFor(lead.id).id, '2026-12-09 10:00');

  const before = noteCount();
  await app.post('/q/' + lead.public_token + '/schedule', { decision: 'accept' }, { ip: '203.0.113.71' });

  assert.equal(noteCount(), before + 1, 'a new offer is a new acceptance');
  assert.equal(jobFor(lead.id).scheduled_for, '2026-12-09 10:00');
});

test('asking for a different time notifies the business', async () => {
  const lead = await newLead('6165550213', '203.0.113.72');
  await sendQuote(lead.id, '450.00');
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.72' });
  await propose(jobFor(lead.id).id, '2026-12-03 09:00');

  const before = noteCount();
  await app.post(
    '/q/' + lead.public_token + '/schedule',
    { decision: 'change', message: 'Could we do an afternoon?' },
    { ip: '203.0.113.72' }
  );

  assert.equal(noteCount(), before + 1);
  const mail = lastNote();
  assert.equal(mail.subject, 'Customer requested a different time — ' + lead.work_ref);
  assert.ok(bodyOf(mail).includes('Could we do an afternoon?'));
  assert.equal(mail.reply_to, CUSTOMER_EMAIL);
});

test('sending the same change request twice notifies once', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  const before = noteCount();

  await app.post(
    '/q/' + lead.public_token + '/schedule',
    { decision: 'change', message: 'Could we do an afternoon?' },
    { ip: '203.0.113.72' }
  );

  assert.equal(noteCount(), before, 'the repeat sends nothing');
});

// ---------------------------------------------------------------- the rules

test('no notification ever contains a private customer token', async () => {
  const tokens = app.read.prepare('select public_token from leads').all().map((r) => r.public_token);
  assert.ok(tokens.length > 5, 'there should be plenty of leads by now');

  for (const mail of notes()) {
    const body = JSON.stringify(mail);
    for (const token of tokens) {
      assert.ok(!body.includes(token), 'a notification leaked a private token');
    }
    assert.doesNotMatch(body, /\/q\//, 'and no private URL shape at all');
  }
});

test('every notification goes to BUSINESS_EMAIL and nowhere else', async () => {
  assert.ok(noteCount() > 10, 'there should be plenty to check');
  for (const mail of notes()) {
    assert.deepEqual(mail.to, [BUSINESS_EMAIL]);
    assert.equal(mail.from, EMAIL_FROM);
  }
});

test('every notification links the admin, which still demands a password', async () => {
  const mail = lastNote();
  const link = bodyOf(mail).match(/https:\/\/getrydja\.com(\/admin\/[a-z]+\/\d+)/);
  assert.ok(link, 'there should be an admin link');

  // Same path, asked for without a session.
  const res = await app.get(link[1]);
  assert.equal(res.status, 302, 'the admin link must not serve without a login');
  assert.match(res.headers.get('location'), /\/admin\/login/);
});

test('no PII reaches the log', async () => {
  const log = app.logs();
  for (const needle of [
    CUSTOMER_EMAIL,
    '6165550201',
    'Can you take a piano?',
    'Mornings are hard for me.',
    'Could we do an afternoon?',
    'Before the closing on the 14th'
  ]) {
    assert.ok(!log.includes(needle), 'the log leaked: ' + needle);
  }
});

// ------------------------------------------------- failure never costs data

test('a provider outage loses no lead and still shows the success page', async () => {
  mailbox.failWith(500);
  try {
    const countBefore = app.read.prepare('select count(*) as n from leads').get().n;

    const res = await app.post(
      '/quote',
      pairs({ ...submission({ phone: '6165550214', email: CUSTOMER_EMAIL }), form_stamp: await freshStamp(app) }),
      { ip: '203.0.113.73' }
    );

    assert.equal(res.status, 302, 'the customer is still redirected');
    assert.equal(res.headers.get('location'), '/quote/sent', 'to the normal success page');
    assert.equal(
      app.read.prepare('select count(*) as n from leads').get().n,
      countBefore + 1,
      'and the lead is saved'
    );
  } finally {
    mailbox.succeed();
  }
});

test('a provider outage does not undo a quote approval or a booking', async () => {
  const lead = await newLead('6165550215', '203.0.113.74');
  await sendQuote(lead.id, '450.00', { proposed_for: '2026-12-04 08:00' });

  mailbox.failWith(500);
  try {
    await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve_confirm' }, { ip: '203.0.113.74' });

    const quote = app.read.prepare('select * from quotes where lead_id = ? order by id desc limit 1').get(lead.id);
    assert.equal(quote.status, 'approved', 'the approval stands');

    const job = jobFor(lead.id);
    assert.ok(job, 'the job was created');
    assert.equal(job.status, 'scheduled', 'and the booking stands');
    assert.equal(job.scheduled_for, '2026-12-04 08:00');
  } finally {
    mailbox.succeed();
  }
});

test('a provider outage does not lose a customer question', async () => {
  const lead = await newLead('6165550216', '203.0.113.75');
  await sendQuote(lead.id, '450.00');

  mailbox.failWith(500);
  try {
    await app.post('/q/' + lead.public_token + '/ask', { question: 'Is Saturday possible?' }, { ip: '203.0.113.75' });

    const stored = app.read.prepare('select customer_message from leads where id = ?').get(lead.id);
    assert.equal(stored.customer_message, 'Is Saturday possible?', 'the question is saved regardless');
  } finally {
    mailbox.succeed();
  }
});

test('a failure is logged as a reason code, with no address and no provider body', async () => {
  const log = app.logs();
  assert.match(log, /\[notify\] RYDJA-\w+ — not sent \(http_500\)/, 'reference and reason code');
  assert.ok(!log.includes('nope'), 'never the provider response body');
});

// ------------------------------------------- nothing addressed into a header

test('a customer address is only used as Reply-To when it is a plain address', async () => {
  const mailModule = require('../mail');

  assert.equal(mailModule.safeAddress('dana@example.com'), 'dana@example.com');
  for (const bad of [
    'dana@example.com\r\nBcc: someone@evil.test',
    'dana@example.com\nBcc: someone@evil.test',
    '"Dana" <dana@example.com>',
    'dana@example.com, other@evil.test',
    'not an address',
    '',
    null,
    undefined
  ]) {
    assert.equal(mailModule.safeAddress(bad), '', 'should have been rejected: ' + JSON.stringify(bad));
  }
});

// ------------------------------------------- the customer side is unchanged

test('the customer still gets their own mail, unchanged', async () => {
  const lead = await newLead('6165550217', '203.0.113.76');

  const before = mailbox.sent.filter((m) => m.to.includes(CUSTOMER_EMAIL)).length;
  await sendQuote(lead.id, '450.00');

  const theirs = mailbox.sent.filter((m) => m.to.includes(CUSTOMER_EMAIL));
  assert.equal(theirs.length, before + 1, 'one quote email to the customer');

  const mail = theirs[theirs.length - 1];
  assert.equal(mail.from, EMAIL_FROM);
  assert.equal(mail.reply_to, BUSINESS_EMAIL, 'their reply still reaches the business');
  assert.ok(mail.html.includes('/q/' + lead.public_token), 'and it still carries their private link');
});
