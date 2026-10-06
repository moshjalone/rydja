'use strict';

// Scheduling preferences at intake, and agreeing to a price and a time in one
// click.
//
// The through-line of every test here: a preference is something the customer
// would like, and only a time the owner proposed and the customer confirmed
// ever reaches jobs.scheduled_for.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, freshStamp, submission } = require('./helpers');

const SITE_URL = 'https://test.example';

let app;
let mailbox;
let cookie;

// ---------------------------------------------------------------- stub

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
      res.end('{"id":"stub"}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        sent,
        url: 'http://127.0.0.1:' + server.address().port,
        last: () => sent[sent.length - 1],
        close: () => server.close()
      });
    });
  });
}

// ---------------------------------------------------------------- helpers

/** A date n days from today, as the form submits it: bare YYYY-MM-DD. */
function daysOut(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

async function submitLead(fields, ip) {
  const res = await app.post('/quote', submission({ ...fields, form_stamp: await freshStamp(app) }), { ip });
  assert.equal(res.status, 302, 'the lead should have been accepted');
  assert.equal(res.headers.get('location'), '/quote/sent');
  return app.read.prepare('select * from leads order by id desc limit 1').get();
}

const sendQuote = (leadId, fields) =>
  app.post('/admin/leads/' + leadId + '/quote', fields, { headers: { cookie }, ip: '203.0.113.99' });

const respond = (token, fields) => app.post('/q/' + token + '/respond', fields, { ip: '203.0.113.90' });

const jobFor = (leadId) => app.read.prepare('select * from jobs where lead_id = ?').get(leadId);

test.before(async () => {
  mailbox = await startMailStub();
  app = await startServer({
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'RYDJA <quotes@test.example>',
    RESEND_API_BASE: mailbox.url,
    SITE_URL,
    BUSINESS_PHONE: '1-616-929-3360'
  });
  cookie = await app.adminCookie();
});

test.after(() => {
  app?.stop();
  mailbox?.close();
});

// ---------------------------------------------------------------- intake

test('the form offers scheduling preferences and says they are not bookings', async () => {
  const html = await (await app.get('/quote')).text();

  assert.match(html, /When would you like us to come\?/);
  assert.match(html, /These are preferred times, not confirmed appointments/);
  assert.match(html, /We&rsquo;ll confirm availability with your quote|We’ll confirm availability with your quote/);

  for (const field of ['preferred_date_1', 'preferred_window_1', 'preferred_date_2', 'preferred_window_2',
                       'scheduling_flexible', 'scheduling_note']) {
    assert.ok(html.includes('name="' + field + '"'), 'the form should collect ' + field);
  }
  for (const w of ['Morning', 'Midday', 'Afternoon', 'Evening', 'Flexible']) {
    assert.ok(html.includes('>' + w + ' '), 'window option: ' + w);
  }

  // None of it may be required — the lead is the point.
  assert.doesNotMatch(html, /name="preferred_date_1"[^>]*required/);
  assert.doesNotMatch(html, /name="scheduling_note"[^>]*required/);
});

test('a lead submits perfectly well with no preferences at all', async () => {
  const lead = await submitLead({ phone: '6165550401' }, '203.0.113.91');

  assert.equal(lead.pref_date_1, null);
  assert.equal(lead.pref_window_1, null);
  assert.equal(lead.pref_date_2, null);
  assert.equal(lead.scheduling_flexible, 0);
  assert.equal(lead.scheduling_note, null);
  assert.ok(lead.work_ref, 'and still gets its permanent reference');
});

test('a lead submits with one preferred date', async () => {
  const date = daysOut(5);
  const lead = await submitLead(
    { phone: '6165550402', preferred_date_1: date, preferred_window_1: 'afternoon' },
    '203.0.113.92'
  );

  assert.equal(lead.pref_date_1, date, 'stored exactly as the day they picked');
  assert.equal(lead.pref_window_1, 'afternoon');
  assert.equal(lead.pref_date_2, null);
});

test('a lead submits with two preferred dates, flexible and a note', async () => {
  const first = daysOut(6);
  const second = daysOut(7);
  const lead = await submitLead(
    {
      phone: '6165550403',
      preferred_date_1: first,
      preferred_window_1: 'afternoon',
      preferred_date_2: second,
      preferred_window_2: 'morning',
      scheduling_flexible: '1',
      scheduling_note: 'After 3 PM is easiest.'
    },
    '203.0.113.93'
  );

  assert.equal(lead.pref_date_1, first);
  assert.equal(lead.pref_window_1, 'afternoon');
  assert.equal(lead.pref_date_2, second);
  assert.equal(lead.pref_window_2, 'morning');
  assert.equal(lead.scheduling_flexible, 1);
  assert.equal(lead.scheduling_note, 'After 3 PM is easiest.');
});

// ---------------------------------------------------------------- validation

test('nonsense preferences are dropped, never a reason to refuse the lead', async () => {
  const cases = [
    ['not-a-date', 'a free-text date'],
    ['2026-02-31', 'a day that does not exist'],
    ['1999-01-01', 'the distant past'],
    ['2099-01-01', 'the distant future']
  ];

  let phone = 6165550410;
  for (const [value, why] of cases) {
    const lead = await submitLead(
      { phone: String(++phone), preferred_date_1: value, preferred_window_1: 'morning' },
      '203.0.113.9' + (phone % 7)
    );
    assert.ok(lead.id, 'the lead is still accepted despite ' + why);
    assert.equal(lead.pref_date_1, null, why + ' should be dropped');
    assert.equal(lead.pref_window_1, null, 'and its window with it');
  }

  // A window that is not one of ours cannot be injected either.
  const lead = await submitLead(
    { phone: '6165550420', preferred_date_1: daysOut(3), preferred_window_1: '<script>alert(1)</script>' },
    '203.0.113.94'
  );
  assert.equal(lead.pref_window_1, 'flexible', 'an unrecognised window falls back, it is not stored');

  // And the note is capped and stripped like every other free-text field.
  const long = await submitLead(
    { phone: '6165550421', scheduling_note: 'x'.repeat(5000) },
    '203.0.113.95'
  );
  assert.ok(long.scheduling_note.length <= 300, 'the note is capped');
});

test('a preference never reaches a schedule', async () => {
  const lead = await submitLead(
    { phone: '6165550430', preferred_date_1: daysOut(4), preferred_window_1: 'morning', scheduling_flexible: '1' },
    '203.0.113.96'
  );

  // Straight through to an approved job, with the owner proposing nothing.
  await sendQuote(lead.id, { amount: '300.00', notes: '' });
  await respond(lead.public_token, { decision: 'approve' });

  const job = jobFor(lead.id);
  assert.equal(job.status, 'unscheduled', 'a preference is not a booking');
  assert.equal(job.scheduled_for, null, 'and must never populate scheduled_for');
  assert.equal(job.proposed_for, null, 'nor stand in for an owner proposal');
});

// ---------------------------------------------------------------- admin

test('the preferences are on the admin lead page, next to the quote', async () => {
  const lead = await submitLead(
    {
      phone: '6165550440',
      preferred_date_1: daysOut(8),
      preferred_window_1: 'afternoon',
      preferred_date_2: daysOut(9),
      preferred_window_2: 'morning',
      scheduling_flexible: '1',
      scheduling_note: 'After 3 PM is easiest.'
    },
    '203.0.113.97'
  );

  const html = await (await app.get('/admin/leads/' + lead.id, { headers: { cookie } })).text();

  assert.match(html, /Customer availability/);
  assert.match(html, /1st choice/);
  assert.match(html, /2nd choice/);
  assert.match(html, /Afternoon/);
  assert.match(html, /Morning/);
  assert.match(html, /Flexible/);
  assert.match(html, /After 3 PM is easiest\./);
  assert.match(html, /not a booking/i, 'and labelled as a preference');

  // The owner can propose a time right there, but is never made to.
  assert.ok(html.includes('name="proposed_for"'));
  assert.doesNotMatch(html, /name="proposed_for"[^>]*required/);
});

test('preferences survive the conversion into a job', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  await sendQuote(lead.id, { amount: '500.00', notes: '' });
  await respond(lead.public_token, { decision: 'approve' });

  const after = app.read
    .prepare('select l.* from leads l join jobs j on j.lead_id = l.id where l.id = ?')
    .get(lead.id);

  assert.equal(after.pref_date_1, lead.pref_date_1);
  assert.equal(after.pref_window_1, 'afternoon');
  assert.equal(after.pref_date_2, lead.pref_date_2);
  assert.equal(after.scheduling_flexible, 1);
  assert.equal(after.scheduling_note, 'After 3 PM is easiest.');
  assert.equal(after.work_ref, lead.work_ref, 'and so does the reference');
  assert.equal(after.public_token, lead.public_token, 'and the token');
});

// ---------------------------------------------------------------- quote only

test('a quote with no proposed time behaves exactly as it always has', async () => {
  const lead = await submitLead({ phone: '6165550450' }, '203.0.113.98');

  const res = await sendQuote(lead.id, { amount: '275.00', notes: 'Includes the shed.' });
  assert.equal(res.status, 302);

  const quote = app.read.prepare('select * from quotes where lead_id = ?').get(lead.id);
  assert.equal(quote.proposed_for, null);

  const page = await (await app.get('/q/' + lead.public_token)).text();
  assert.match(page, /Approve this quote/);
  assert.match(page, /Decline/);
  assert.match(page, /Ask a question/);
  assert.doesNotMatch(page, /Approve quote &amp; confirm time/);

  await respond(lead.public_token, { decision: 'approve' });
  const job = jobFor(lead.id);
  assert.equal(job.status, 'unscheduled');
  assert.equal(job.scheduled_for, null);
});

test('the quote-only email keeps its old subject', () => {
  const mail = mailbox.sent.find((m) => m.subject.includes('$275.00'));
  assert.ok(mail, 'the quote email went out');
  assert.equal(mail.subject, 'Your quote from RYDJA — $275.00');
});

// ---------------------------------------------------------------- quote + time

test('a quote can carry a proposed appointment', async () => {
  const lead = await submitLead(
    { phone: '6165550460', preferred_date_1: daysOut(10), preferred_window_1: 'afternoon' },
    '203.0.113.100'
  );

  const res = await sendQuote(lead.id, {
    amount: '640.00',
    notes: 'Two hours, one truck.',
    proposed_for: '2026-10-08T13:00'
  });
  assert.equal(res.status, 302);

  const quote = app.read.prepare('select * from quotes where lead_id = ?').get(lead.id);
  assert.equal(quote.proposed_for, '2026-10-08 13:00', 'attached to the quote');
  assert.equal(quote.status, 'sent');
  assert.equal(jobFor(lead.id), undefined, 'and still no job — nothing is approved yet');
});

test('the email carries the reference, the amount and the proposed time', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  const mail = mailbox.last();

  assert.equal(mail.subject, 'Quote & proposed appointment from RYDJA — ' + lead.work_ref);

  for (const body of [mail.html, mail.text]) {
    assert.ok(body.includes(lead.work_ref), 'the permanent reference');
    assert.match(body, /\$640\.00/, 'the amount');
    assert.match(body, /Thursday, October 8/, 'the proposed day');
    assert.match(body, /1:00 PM/, 'the proposed time');
    assert.match(body, /Two hours, one truck\./, 'the notes');
    assert.ok(body.includes(SITE_URL + '/q/' + lead.public_token), 'the private link');
  }
  assert.match(mail.html, /Review your quote/);
});

test('the customer sees the price and the time together, with one button for both', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  const html = await (await app.get('/q/' + lead.public_token)).text();

  assert.match(html, /\$640\.00/);
  assert.match(html, /PROPOSED APPOINTMENT/);
  assert.match(html, /Oct 8, 2026/);
  assert.match(html, /1:00 PM/);

  assert.match(html, /Approve quote &amp; confirm time/, 'the primary action');
  assert.match(html, /Approve, but I need a different time/, 'the secondary');
  assert.match(html, /Decline quote/);
  assert.match(html, /Ask a question/);
  assert.ok(html.includes('JOB ' + lead.work_ref) || html.includes('REQUEST ' + lead.work_ref));
});

test('approve and confirm books it in one action', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();

  const res = await respond(lead.public_token, { decision: 'approve_confirm' });
  assert.equal(res.status, 302);

  const job = jobFor(lead.id);
  assert.ok(job, 'the job exists');
  assert.equal(job.status, 'scheduled');
  assert.equal(job.scheduled_for, '2026-10-08 13:00', 'the proposed time became the booked one');
  assert.equal(job.proposed_for, '2026-10-08 13:00');
  assert.ok(job.schedule_responded_at, 'their answer is stamped');
  assert.equal(app.read.prepare('select status from quotes where id = ?').get(job.quote_id).status, 'approved');
  assert.equal(app.read.prepare('select status from leads where id = ?').get(lead.id).status, 'converted');

  const page = await (await app.get('/q/' + lead.public_token)).text();
  assert.match(page, /You&rsquo;re booked\./);
  assert.match(page, /Oct 8, 2026/);
});

test('a double-clicked approval cannot create a second job', async () => {
  const lead = await submitLead({ phone: '6165550470' }, '203.0.113.101');
  await sendQuote(lead.id, { amount: '710.00', notes: '', proposed_for: '2026-11-04T10:00' });

  // Both clicks land at once, as a double-tap on a phone does.
  const [a, b] = await Promise.all([
    respond(lead.public_token, { decision: 'approve_confirm' }),
    respond(lead.public_token, { decision: 'approve_confirm' })
  ]);
  assert.equal(a.status, 302);
  assert.equal(b.status, 302);

  const jobs = app.read.prepare('select * from jobs where lead_id = ?').all(lead.id);
  assert.equal(jobs.length, 1, 'exactly one job, however many times they clicked');
  assert.equal(jobs[0].status, 'scheduled');
  assert.equal(jobs[0].scheduled_for, '2026-11-04 10:00');

  // And a third, later click still changes nothing.
  await respond(lead.public_token, { decision: 'approve_confirm' });
  assert.equal(app.read.prepare('select count(*) as n from jobs where lead_id = ?').get(lead.id).n, 1);
});

// ---------------------------------------------------------------- yes, but not then

test('approving while asking for another time leaves it unbooked', async () => {
  const lead = await submitLead({ phone: '6165550480' }, '203.0.113.102');
  await sendQuote(lead.id, { amount: '820.00', notes: '', proposed_for: '2026-12-02T08:00' });

  const res = await respond(lead.public_token, {
    decision: 'approve_change',
    message: 'I want the job, but mornings are impossible. Any afternoon works.'
  });
  assert.equal(res.status, 302);

  const job = jobFor(lead.id);
  assert.ok(job, 'the work is accepted, so there is a job');
  assert.equal(job.status, 'schedule_pending');
  assert.equal(job.scheduled_for, null, 'but nothing is booked');
  assert.equal(job.proposed_for, '2026-12-02 08:00', 'the offer they turned down is kept');
  assert.equal(job.schedule_message, 'I want the job, but mornings are impossible. Any afternoon works.');
  assert.ok(job.schedule_responded_at);

  assert.equal(app.read.prepare('select status from quotes where id = ?').get(job.quote_id).status, 'approved');

  // The owner reads it and can propose again through the existing flow.
  const admin = await (await app.get('/admin/jobs/' + job.id, { headers: { cookie } })).text();
  assert.match(admin, /Change requested/);
  assert.match(admin, /mornings are impossible/);

  await app.post(
    '/admin/jobs/' + job.id + '/propose',
    { proposed_for: '2026-12-03T14:00' },
    { headers: { cookie }, ip: '203.0.113.99' }
  );
  await app.post('/q/' + lead.public_token + '/schedule', { decision: 'accept' }, { ip: '203.0.113.90' });

  const booked = jobFor(lead.id);
  assert.equal(booked.scheduled_for, '2026-12-03 14:00');
  assert.equal(booked.status, 'scheduled');
});

// ---------------------------------------------------------------- questions

test('a question is saved against the lead for the owner to answer', async () => {
  const lead = await submitLead({ phone: '6165550490' }, '203.0.113.103');
  await sendQuote(lead.id, { amount: '150.00', notes: '' });

  const res = await app.post(
    '/q/' + lead.public_token + '/ask',
    { question: 'Does the price cover the shed out back?' },
    { ip: '203.0.113.90' }
  );
  assert.equal(res.status, 302);

  const after = app.read.prepare('select * from leads where id = ?').get(lead.id);
  assert.equal(after.customer_message, 'Does the price cover the shed out back?');
  assert.ok(after.customer_message_at);

  // Asking does not answer the quote.
  assert.equal(app.read.prepare('select status from quotes where lead_id = ?').get(lead.id).status, 'sent');
  assert.equal(jobFor(lead.id), undefined);

  const admin = await (await app.get('/admin/leads/' + lead.id, { headers: { cookie } })).text();
  assert.match(admin, /They asked a question/);
  assert.match(admin, /Does the price cover the shed out back\?/);
});

// ---------------------------------------------------------------- identity

test('reference and token are unchanged by every path through this flow', async () => {
  const rows = app.read
    .prepare('select l.id, l.work_ref, l.public_token from leads l join jobs j on j.lead_id = l.id')
    .all();
  assert.ok(rows.length >= 4, 'several jobs reached by different routes');

  for (const row of rows) {
    assert.match(row.work_ref, /^RYDJA-[23456789ABCDEFGHJKMNPQRSTWXYZ]{6}$/);
    assert.match(row.public_token, /^[0-9a-f]{32}$/);
    assert.notEqual(row.work_ref, row.public_token);
  }

  // One reference per lead, and no two leads sharing one.
  const refs = app.read.prepare('select work_ref from leads').all().map((l) => l.work_ref);
  assert.equal(new Set(refs).size, refs.length, 'references stay unique');
});

test('nothing private reaches the log', () => {
  const log = app.logs();

  for (const { public_token: token } of app.read.prepare('select public_token from leads').all()) {
    assert.ok(!log.includes(token), 'a private token must never be logged');
  }
  assert.ok(!log.includes('After 3 PM is easiest'), 'not a scheduling note');
  assert.ok(!log.includes('mornings are impossible'), 'not a scheduling message');
  assert.ok(!log.includes('shed out back'), 'not a question');
  assert.ok(!log.includes('Dana Reed'), 'not a name');
  assert.ok(!log.includes('dana@example.com'), 'not an address');

  assert.match(log, /\[job\] RYDJA-[A-Z0-9]{6} quote scheduled by customer/);
  assert.match(log, /\[job\] RYDJA-[A-Z0-9]{6} quote schedule_pending by customer/);
  assert.match(log, /\[question\] RYDJA-[A-Z0-9]{6} asked a question/);
});
