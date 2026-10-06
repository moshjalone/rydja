'use strict';

// The quote email: what goes out, what does not, and what happens when the
// provider says no.
//
// A local stub stands in for Resend — the server is pointed at it with
// RESEND_API_BASE, so these tests exercise the real fetch call, the real body
// and the real failure handling without ever reaching the network.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, freshStamp, submission } = require('./helpers');

const SITE_URL = 'https://test.example';
const EMAIL_FROM = 'RYDJA <quotes@test.example>';
const API_KEY = 're_test_key_not_a_real_one';

const CUSTOMER = {
  name: 'Dana Reed',
  phone: '6165550144',
  email: 'dana@example.com'
};

let app;
let mailbox;

// ---------------------------------------------------------------- stub

/** Stands in for api.resend.com. Records what it was asked to send. */
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
      sent.push({ path: req.url, auth: req.headers.authorization, mail: parsed });
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(reply.body);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        sent,
        url: 'http://127.0.0.1:' + server.address().port,
        /** Make the next send fail the way a provider would. */
        failWith(status, body = '{"message":"stub failure"}') {
          reply = { status, body };
        },
        succeed() {
          reply = { status: 200, body: '{"id":"stub-message-id"}' };
        },
        last: () => sent[sent.length - 1]?.mail,
        close: () => server.close()
      });
    });
  });
}

// ---------------------------------------------------------------- helpers

/** Put a lead in the database through the real public form. */
async function createLead(fields, ip) {
  const res = await app.post(
    '/quote',
    submission({ ...fields, form_stamp: await freshStamp(app) }),
    { ip }
  );
  assert.equal(res.status, 302, 'the test lead should have been accepted');
  return app.read.prepare('select * from leads order by id desc limit 1').get();
}

/** Send a quote as the admin, the way the owner does from the lead page. */
async function sendQuote(leadId, amount, notes = '') {
  const cookie = await app.adminCookie();
  return app.post(
    '/admin/leads/' + leadId + '/quote',
    { amount, notes },
    { headers: { cookie }, ip: '203.0.113.99' }
  );
}

test.before(async () => {
  mailbox = await startMailStub();
  app = await startServer({
    RESEND_API_KEY: API_KEY,
    EMAIL_FROM,
    RESEND_API_BASE: mailbox.url,
    SITE_URL,
    BUSINESS_PHONE: '(616) 555-0100'
  });
});

test.after(() => {
  app?.stop();
  mailbox?.close();
});

// ---------------------------------------------------------------- no email

test('a quote still saves when the customer gave no email address', async () => {
  const before = mailbox.sent.length;
  const lead = await createLead({ email: '', phone: '6165550101' }, '203.0.113.20');

  const res = await sendQuote(lead.id, '300.00');

  // The quote is the point. Email is a courtesy on top of it.
  const quote = app.read.prepare('select * from quotes where lead_id = ?').get(lead.id);
  assert.equal(quote.amount_cents, 30000);
  assert.equal(app.read.prepare('select status from leads where id = ?').get(lead.id).status, 'quoted');

  assert.equal(mailbox.sent.length, before, 'nothing should have been sent');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\?mail=no_email$/);
});

// ---------------------------------------------------------------- sending

test('a quote for a customer with an email sends one', async () => {
  const before = mailbox.sent.length;
  const lead = await createLead({ ...CUSTOMER, phone: '6165550102' }, '203.0.113.21');

  const res = await sendQuote(lead.id, '450.00', 'Two hours, one truck. Dump fees included.');

  assert.equal(mailbox.sent.length, before + 1, 'exactly one send');
  const call = mailbox.sent[mailbox.sent.length - 1];

  assert.equal(call.path, '/emails');
  assert.equal(call.auth, 'Bearer ' + API_KEY);
  assert.equal(call.mail.from, EMAIL_FROM);
  assert.deepEqual(call.mail.to, [CUSTOMER.email]);

  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\?mail=sent$/);
});

test('the email carries the amount, the notes and the private quote URL', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  const mail = mailbox.last();
  const url = SITE_URL + '/q/' + lead.public_token;

  // Both parts, because a mail client may render either one.
  for (const body of [mail.html, mail.text]) {
    assert.match(body, /\$450\.00/, 'the quoted amount');
    assert.ok(body.includes(url), 'the private quote URL, built from SITE_URL');
    assert.match(body, /Two hours, one truck\. Dump fees included\./, 'the notes meant for the customer');
    assert.match(body, /RYDJA/, 'branding');
    assert.match(body, /Dana/, 'the customer by name');
    assert.match(body, /\(616\) 555-0100/, 'the business phone number');
  }

  assert.match(mail.subject, /\$450\.00/);
  assert.match(mail.subject, /RYDJA/);

  // The customer has to know they can act on it, and that nothing is committed
  // until they do.
  assert.match(mail.text, /approve or decline/i);
  assert.match(mail.html, /approve or decline/i);
  assert.match(mail.html, /Review your quote/);
});

// ---------------------------------------------------------------- revisions

test('a revised quote sends a fresh email that reads as a revision', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  const before = mailbox.sent.length;

  const res = await sendQuote(lead.id, '525.00', 'Revised after the photos of the attic.');

  assert.equal(mailbox.sent.length, before + 1, 'a revision sends again');
  const mail = mailbox.last();

  assert.match(mail.subject, /Revised quote/i);
  assert.match(mail.text, /\$525\.00/);
  assert.ok(mail.html.includes(SITE_URL + '/q/' + lead.public_token), 'same private link');

  // And the revision really did replace the quote, not stack on it.
  const quotes = app.read.prepare("select * from quotes where lead_id = ? and status = 'sent'").all(lead.id);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].amount_cents, 52500);
  assert.match(res.headers.get('location'), /\?mail=sent$/);
});

// ---------------------------------------------------------------- failure

test('a failed send does not roll back the quote', async () => {
  const lead = await createLead({ ...CUSTOMER, phone: '6165550103' }, '203.0.113.22');
  mailbox.failWith(422);

  try {
    const res = await sendQuote(lead.id, '615.00', 'Includes the shed.');

    // Saved regardless — that is the whole point of sending after the commit.
    const quote = app.read.prepare("select * from quotes where lead_id = ? and status = 'sent'").get(lead.id);
    assert.ok(quote, 'the quote must survive a failed send');
    assert.equal(quote.amount_cents, 61500);
    assert.equal(app.read.prepare('select status from leads where id = ?').get(lead.id).status, 'quoted');

    // And the owner is told, so they can text the link by hand.
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /\?mail=http_422$/);

    const cookie = await app.adminCookie();
    const page = await (await app.get('/admin/leads/' + lead.id + '?mail=http_422', { headers: { cookie } })).text();
    assert.match(page, /could not be delivered/i);
    assert.match(page, /http_422/);
  } finally {
    mailbox.succeed();
  }
});

test('a quote still saves when email is switched off entirely', async () => {
  // A second server with no key at all — the state a host is in before anyone
  // sets the variables.
  const bare = await startServer({ SITE_URL });
  try {
    const res = await bare.post(
      '/quote',
      submission({ ...CUSTOMER, form_stamp: await freshStamp(bare) }),
      { ip: '203.0.113.23' }
    );
    assert.equal(res.status, 302);

    const lead = bare.read.prepare('select * from leads order by id desc limit 1').get();
    const cookie = await bare.adminCookie();
    const quoted = await bare.post(
      '/admin/leads/' + lead.id + '/quote',
      { amount: '275.00', notes: '' },
      { headers: { cookie }, ip: '203.0.113.99' }
    );

    assert.equal(quoted.status, 302);
    assert.match(quoted.headers.get('location'), /\?mail=not_configured$/);
    assert.equal(bare.read.prepare('select * from quotes where lead_id = ?').get(lead.id).amount_cents, 27500);
  } finally {
    bare.stop();
  }
});

// ---------------------------------------------------------------- logging

test('no address, name, phone or token reaches the log', async () => {
  const log = app.logs();
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();

  // Tokens are the capability that protects a customer's page — one in a log
  // file is a leaked credential.
  const tokens = app.read.prepare('select public_token from leads').all().map((l) => l.public_token);
  for (const token of tokens) {
    assert.ok(!log.includes(token), 'a quote token must never be logged');
  }
  assert.ok(!log.includes(CUSTOMER.email), 'an email address must never be logged');

  // The [mail] lines are what this feature added, so they are held to the
  // whole rule: reason codes and a lead id, nothing about the person. (The
  // pre-existing [lead] line does name the customer; that is out of scope
  // here and deliberately not asserted on.)
  const mailLines = log.split('\n').filter((l) => l.includes('[mail]'));
  assert.ok(mailLines.length >= 3, 'the sends above should have been logged');

  for (const line of mailLines) {
    assert.ok(!line.includes(CUSTOMER.name), 'no customer name');
    assert.ok(!line.includes('Dana'), 'no first name either');
    assert.ok(!line.includes(CUSTOMER.phone), 'no phone number');
    assert.ok(!line.includes('@'), 'no address, and no sender either');
    assert.match(line, /lead #\d+/, 'a lead id is the only identifier allowed');
  }

  // The reasons that actually occurred, in the shape the runbook documents.
  assert.match(log, /\[mail\] quote email sent for lead #\d+/);
  assert.match(log, /\[mail\] lead #\d+ has no email on file/);
  assert.match(log, /\[mail\] quote email FAILED for lead #\d+ \(http_422\)/);

  assert.ok(lead, 'sanity: the suite created leads');
});
