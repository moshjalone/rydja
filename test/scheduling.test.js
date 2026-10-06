'use strict';

// Scheduling: the owner proposes, the customer answers, and only the answer
// books anything.
//
// A local stub stands in for Resend, so the real fetch, body and failure
// handling are exercised without touching the network.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, freshStamp, submission } = require('./helpers');

const SITE_URL = 'https://test.example';
const EMAIL_FROM = 'RYDJA <quotes@test.example>';
const PHONE = '1-616-929-3360';

let app;
let mailbox;
let cookie;

// ---------------------------------------------------------------- stub

function startMailStub() {
  const sent = [];
  let reply = { status: 200, body: '{"id":"stub"}' };

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
        failWith: (status) => {
          reply = { status, body: '{"message":"stub failure"}' };
        },
        succeed: () => {
          reply = { status: 200, body: '{"id":"stub"}' };
        },
        last: () => sent[sent.length - 1],
        close: () => server.close()
      });
    });
  });
}

// ---------------------------------------------------------------- helpers

/** A lead carried all the way to an approved quote, i.e. a fresh job. */
async function jobReadyToSchedule(phone, ip, email = 'dana@example.com') {
  const res = await app.post('/quote', submission({ phone, email, form_stamp: await freshStamp(app) }), { ip });
  assert.equal(res.status, 302, 'the test lead should have been accepted');

  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  await app.post(
    '/admin/leads/' + lead.id + '/quote',
    { amount: '450.00', notes: '' },
    { headers: { cookie }, ip: '203.0.113.99' }
  );
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.99' });

  const job = app.read.prepare('select * from jobs where lead_id = ?').get(lead.id);
  assert.ok(job, 'approving the quote should have created a job');
  return { lead, job };
}

const reload = (id) => app.read.prepare('select * from jobs where id = ?').get(id);

const propose = (jobId, when) =>
  app.post('/admin/jobs/' + jobId + '/propose', { proposed_for: when }, { headers: { cookie }, ip: '203.0.113.99' });

const answer = (token, fields) => app.post('/q/' + token + '/schedule', fields, { ip: '203.0.113.80' });

test.before(async () => {
  mailbox = await startMailStub();
  app = await startServer({
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM,
    RESEND_API_BASE: mailbox.url,
    SITE_URL,
    BUSINESS_PHONE: PHONE
  });
  cookie = await app.adminCookie();
});

test.after(() => {
  app?.stop();
  mailbox?.close();
});

// ---------------------------------------------------------------- the job

test('an approved quote creates an unscheduled job with nothing proposed', async () => {
  const { job } = await jobReadyToSchedule('6165550301', '203.0.113.81');

  assert.equal(job.status, 'unscheduled');
  assert.equal(job.scheduled_for, null);
  assert.equal(job.proposed_for, null);
  assert.equal(job.proposed_at, null);
});

// ---------------------------------------------------------------- proposing

test('proposing a time does not book it', async () => {
  const { lead, job } = await jobReadyToSchedule('6165550302', '203.0.113.82');

  const res = await propose(job.id, '2026-03-12T09:00');
  assert.equal(res.status, 302);

  const after = reload(job.id);
  assert.equal(after.proposed_for, '2026-03-12 09:00', 'the offer is stored');
  assert.ok(after.proposed_at, 'and stamped with when it went out');
  assert.equal(after.status, 'schedule_pending', 'the job is waiting on the customer');
  assert.equal(after.scheduled_for, null, 'nothing is booked until the customer says so');
  assert.equal(after.schedule_responded_at, null);

  // The admin page says exactly that.
  const page = await (await app.get('/admin/jobs/' + job.id, { headers: { cookie } })).text();
  assert.match(page, /Awaiting customer/);
  assert.ok(page.includes(lead.work_ref));
});

test('the customer page shows the proposed time and both ways to answer', async () => {
  const lead = app.read
    .prepare('select l.* from leads l join jobs j on j.lead_id = l.id order by j.id desc limit 1')
    .get();
  const html = await (await app.get('/q/' + lead.public_token)).text();

  assert.match(html, /Proposed appointment/);
  assert.match(html, /Mar 12, 2026/, 'the date, as a person reads it');
  assert.match(html, /9:00 AM/);
  assert.match(html, /Accept this time/);
  assert.match(html, /Ask for a different time/);
  assert.match(html, /What works better for you\?/);
  assert.ok(html.includes('JOB ' + lead.work_ref), 'labelled with the permanent reference');
});

// ---------------------------------------------------------------- the email

test('the proposal email carries the reference, the time and the private link', async () => {
  const lead = app.read
    .prepare('select l.* from leads l join jobs j on j.lead_id = l.id order by j.id desc limit 1')
    .get();
  const mail = mailbox.last();

  assert.equal(mail.subject, 'Proposed appointment for ' + lead.work_ref);

  for (const body of [mail.html, mail.text]) {
    assert.ok(body.includes(lead.work_ref), 'the permanent reference');
    assert.match(body, /Thursday, March 12/, 'the proposed day');
    assert.match(body, /9:00 AM/, 'the proposed time');
    assert.match(body, /Garage \/ basement cleanout/, 'the service');
    assert.ok(body.includes(SITE_URL + '/q/' + lead.public_token), 'SITE_URL + /q/:token');
    assert.match(body, /confirm this appointment or ask for a different time/i);
    assert.match(body, /RYDJA/);
    assert.ok(body.includes(PHONE), 'the business phone');
  }

  assert.ok(mail.html.includes('href="tel:+16169293360"'), 'dialable');
});

test('a proposal survives a failed email, and the owner is told', async () => {
  const { lead, job } = await jobReadyToSchedule('6165550303', '203.0.113.83');
  mailbox.failWith(500);

  try {
    const res = await propose(job.id, '2026-04-02T14:30');

    const after = reload(job.id);
    assert.equal(after.proposed_for, '2026-04-02 14:30', 'the proposal is kept regardless');
    assert.equal(after.status, 'schedule_pending');
    assert.equal(after.scheduled_for, null);
    assert.match(res.headers.get('location'), /\?schedule=http_500$/);

    const page = await (await app.get('/admin/jobs/' + job.id + '?schedule=http_500', { headers: { cookie } })).text();
    assert.match(page, /could not be delivered/i);
    assert.match(page, /send their private link manually/i);
    assert.ok(page.includes(lead.work_ref));
  } finally {
    mailbox.succeed();
  }
});

test('a proposal still saves for a customer with no email address', async () => {
  const { job } = await jobReadyToSchedule('6165550304', '203.0.113.84', '');
  const before = mailbox.sent.length;

  const res = await propose(job.id, '2026-04-09T08:00');

  assert.equal(reload(job.id).proposed_for, '2026-04-09 08:00');
  assert.equal(reload(job.id).status, 'schedule_pending');
  assert.equal(mailbox.sent.length, before, 'nothing sent');
  assert.match(res.headers.get('location'), /\?schedule=no_email$/);
});

// ---------------------------------------------------------------- accepting

test('accepting the time is what books it', async () => {
  const { lead, job } = await jobReadyToSchedule('6165550305', '203.0.113.85');
  await propose(job.id, '2026-05-14T11:00');

  const res = await answer(lead.public_token, { decision: 'accept' });
  assert.equal(res.status, 302);

  const after = reload(job.id);
  assert.equal(after.scheduled_for, '2026-05-14 11:00', 'the proposed time becomes the booked one');
  assert.equal(after.scheduled_for, after.proposed_for);
  assert.equal(after.status, 'scheduled');
  assert.ok(after.schedule_responded_at, 'the answer is stamped');
  assert.equal(after.schedule_message, null);

  const page = await (await app.get('/q/' + lead.public_token)).text();
  assert.match(page, /You&rsquo;re scheduled\.|You’re scheduled\./);
  assert.match(page, /May 14, 2026/);

  const admin = await (await app.get('/admin/jobs/' + job.id, { headers: { cookie } })).text();
  assert.match(admin, /Confirmed/);
});

// ---------------------------------------------------------------- declining

test('asking for a different time leaves the job unbooked and tells the owner', async () => {
  const { lead, job } = await jobReadyToSchedule('6165550306', '203.0.113.86');
  await propose(job.id, '2026-06-03T07:30');

  const res = await answer(lead.public_token, {
    decision: 'change',
    message: 'Mornings are hard for me. Any afternoon that week works.'
  });
  assert.equal(res.status, 302);

  const after = reload(job.id);
  assert.equal(after.scheduled_for, null, 'still nothing booked');
  assert.equal(after.status, 'schedule_pending', 'and still waiting');
  assert.equal(after.schedule_message, 'Mornings are hard for me. Any afternoon that week works.');
  assert.ok(after.schedule_responded_at);
  assert.equal(after.proposed_for, '2026-06-03 07:30', 'the offer is still on the table');

  // The owner reads it on the job page.
  const admin = await (await app.get('/admin/jobs/' + job.id, { headers: { cookie } })).text();
  assert.match(admin, /Change requested/);
  assert.match(admin, /Mornings are hard for me\. Any afternoon that week works\./);
});

test('the customer can send another message later', async () => {
  // The job the previous test left with an open change request.
  const job0 = app.read
    .prepare('select * from jobs where schedule_message is not null order by id desc limit 1')
    .get();
  assert.ok(job0, 'precondition: a job with a change request on it');
  const lead = app.read.prepare('select * from leads where id = ?').get(job0.lead_id);
  const job = job0;

  await answer(lead.public_token, { decision: 'change', message: 'Actually the 5th would be ideal.' });

  const after = reload(job.id);
  assert.equal(after.schedule_message, 'Actually the 5th would be ideal.', 'the latest message wins');
  assert.equal(after.scheduled_for, null);
  assert.equal(after.status, 'schedule_pending');
});

// ---------------------------------------------------------------- revising

test('a revised proposal replaces the old one, clears the request and sends again', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  const job = app.read.prepare('select * from jobs where lead_id = ?').get(lead.id);
  const before = mailbox.sent.length;
  assert.ok(reload(job.id).schedule_message, 'precondition: a change was requested');

  const res = await propose(job.id, '2026-06-05T13:00');

  const after = reload(job.id);
  assert.equal(after.proposed_for, '2026-06-05 13:00', 'the new offer replaces the old');
  assert.equal(after.schedule_message, null, 'the change request is cleared');
  assert.equal(after.schedule_responded_at, null, 'and so is their answer to the old one');
  assert.equal(after.status, 'schedule_pending');
  assert.equal(after.scheduled_for, null, 'still not booked');

  assert.equal(mailbox.sent.length, before + 1, 'a revision emails again');
  assert.match(mailbox.last().subject, new RegExp('Proposed appointment for ' + lead.work_ref));
  assert.match(mailbox.last().text, /Friday, June 5/);
  assert.match(res.headers.get('location'), /\?schedule=sent$/);

  // And accepting the revised time books that one.
  await answer(lead.public_token, { decision: 'accept' });
  assert.equal(reload(job.id).scheduled_for, '2026-06-05 13:00');
  assert.equal(reload(job.id).status, 'scheduled');
});

// ---------------------------------------------------------------- guards

test('there is nothing to answer before a time is proposed', async () => {
  const { lead, job } = await jobReadyToSchedule('6165550307', '203.0.113.87');

  const res = await answer(lead.public_token, { decision: 'accept' });
  assert.equal(res.status, 302);

  const after = reload(job.id);
  assert.equal(after.scheduled_for, null, 'acceptance of nothing books nothing');
  assert.equal(after.status, 'unscheduled');
});

test('an empty change message is ignored rather than stored', async () => {
  const lead = app.read
    .prepare('select l.* from leads l join jobs j on j.lead_id = l.id order by j.id desc limit 1')
    .get();
  const job = app.read.prepare('select * from jobs where lead_id = ?').get(lead.id);
  await propose(job.id, '2026-07-01T10:00');

  await answer(lead.public_token, { decision: 'change', message: '   ' });

  assert.equal(reload(job.id).schedule_message, null);
  assert.equal(reload(job.id).scheduled_for, null);
});

// ---------------------------------------------------------------- identity

test('token and reference are untouched by the whole scheduling lifecycle', async () => {
  const { lead, job } = await jobReadyToSchedule('6165550308', '203.0.113.88');
  const ref = lead.work_ref;
  const token = lead.public_token;

  await propose(job.id, '2026-08-11T09:00');
  await answer(token, { decision: 'change', message: 'Could we do the following week?' });
  await propose(job.id, '2026-08-18T09:00');
  await answer(token, { decision: 'accept' });
  await app.post('/admin/jobs/' + job.id + '/status', { status: 'complete' }, { headers: { cookie }, ip: '203.0.113.99' });

  const final = app.read
    .prepare('select l.work_ref, l.public_token from jobs j join leads l on l.id = j.lead_id where j.id = ?')
    .get(job.id);
  assert.equal(final.work_ref, ref);
  assert.equal(final.public_token, token);
  assert.equal(reload(job.id).scheduled_for, '2026-08-18 09:00');
});

// ---------------------------------------------------------------- logging

test('no token, customer or scheduling message reaches the log', () => {
  const log = app.logs();

  for (const { public_token: token } of app.read.prepare('select public_token from leads').all()) {
    assert.ok(!log.includes(token), 'a private token must never be logged');
  }
  assert.ok(!log.includes('Dana Reed'), 'no customer name');
  assert.ok(!log.includes('6165550301'), 'no phone number');
  assert.ok(!log.includes('dana@example.com'), 'no email address');
  assert.ok(!log.includes('Mornings are hard'), 'the scheduling message stays out of the log');
  assert.ok(!log.includes('following week'), 'all of them do');

  // What IS logged: the public reference and a fixed event code.
  assert.match(log, /\[schedule\] RYDJA-[A-Z0-9]{6} confirmed by customer/);
  assert.match(log, /\[schedule\] RYDJA-[A-Z0-9]{6} change requested by customer/);
  assert.match(log, /\[mail\] schedule proposal sent for RYDJA-[A-Z0-9]{6}/);
  assert.match(log, /\[mail\] schedule email FAILED for RYDJA-[A-Z0-9]{6} \(http_500\)/);
});
