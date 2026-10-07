'use strict';

// One public email address, everywhere.
//
// quotes@getrydja.com is what a customer sees on the legal pages, what the
// structured data publishes, and where a reply to any mail we send lands. The
// owner's own address is internal and must never appear on a public page.
//
// The private address used throughout is a @gmail.com one on purpose: these
// tests assert that no public surface leaks it, which is the whole point.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, freshStamp, submission } = require('./helpers');

const SITE_URL = 'https://getrydja.com';
const BUSINESS_EMAIL = 'quotes@getrydja.com';
const EMAIL_FROM = 'RYDJA <quotes@getrydja.com>';
const PHONE = '1-616-929-3360';

/** The internal address. Must never reach a public page or a Reply-To. */
const OWNER_EMAIL = 'getrydja@gmail.com';

/** Every page a crawler or a customer can reach. */
const PUBLIC_PAGES = [
  '/',
  '/quote',
  '/services',
  '/estate-cleanouts',
  '/junk-removal',
  '/cleanouts',
  '/yard-cleanup',
  '/furniture-appliance-removal',
  '/hauling-moving-help',
  '/light-demolition',
  '/service-area',
  '/terms',
  '/privacy',
  '/accessibility'
];

const LEGAL_PAGES = ['/privacy', '/terms', '/accessibility'];

let app;
let mailbox;
let cookie;

// ---------------------------------------------------------------- stub

/** Stands in for api.resend.com, recording the body it was handed. */
function startMailStub() {
  const sent = [];
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
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"id":"stub-message-id"}');
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

test.before(async () => {
  mailbox = await startMailStub();
  app = await startServer({
    SITE_URL,
    BUSINESS_EMAIL,
    EMAIL_FROM,
    BUSINESS_PHONE: PHONE,
    RESEND_API_KEY: 're_test_key_not_a_real_one',
    RESEND_API_BASE: mailbox.url,
    OWNER_NAME: 'Joshua Malone',
    OWNER_EMAIL
  });
  cookie = await app.adminCookie();
});

test.after(() => {
  app?.stop();
  mailbox?.close();
});

const html = (url) => app.get(url).then((r) => r.text());

/** A lead with an email address, carried as far as the caller needs. */
async function createLead(phone, ip) {
  const res = await app.post(
    '/quote',
    submission({ phone, email: 'dana@example.com', form_stamp: await freshStamp(app) }),
    { ip }
  );
  assert.equal(res.status, 302, 'the quote form should accept the submission');
  return app.read.prepare('select * from leads order by id desc limit 1').get();
}

const sendQuote = (leadId, amount) =>
  app.post(
    '/admin/leads/' + leadId + '/quote',
    { amount, notes: '' },
    { headers: { cookie }, ip: '203.0.113.99' }
  );

// ---------------------------------------------------------- the private address

test('no public page leaks the internal owner address', async () => {
  for (const path of PUBLIC_PAGES) {
    const res = await app.get(path);
    assert.equal(res.status, 200, path + ' should be served');

    const doc = await res.text();
    assert.ok(
      !doc.includes(OWNER_EMAIL),
      path + ' must not contain the internal owner address'
    );
    assert.doesNotMatch(doc, /@gmail\.com/i, path + ' must not contain any gmail address');
  }
});

test('the private customer page does not leak it either', async () => {
  const lead = await createLead('6165550181', '203.0.113.41');
  await sendQuote(lead.id, '450.00');

  const doc = await html('/q/' + lead.public_token);
  assert.ok(!doc.includes(OWNER_EMAIL), 'the customer page must not carry the owner address');
  assert.doesNotMatch(doc, /@gmail\.com/i);
});

// ---------------------------------------------------------------- public pages

test('every legal page offers the business email as a mailto link', async () => {
  for (const path of LEGAL_PAGES) {
    const doc = await html(path);
    assert.ok(
      doc.includes('mailto:' + BUSINESS_EMAIL),
      path + ' should link mailto:' + BUSINESS_EMAIL
    );
    assert.ok(doc.includes(BUSINESS_EMAIL), path + ' should show the address as text too');
  }
});

test('no public page carries a mailto to anything but the business email', async () => {
  for (const path of PUBLIC_PAGES) {
    const doc = await html(path);
    for (const [, target] of doc.matchAll(/mailto:([^"'\s>]+)/g)) {
      assert.equal(target, BUSINESS_EMAIL, path + ' links mailto:' + target);
    }
  }
});

test('the structured data publishes the business email and no other', async () => {
  const doc = await html('/');
  const match = doc.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'the homepage should carry JSON-LD');

  const data = JSON.parse(match[1]);
  assert.equal(data.email, BUSINESS_EMAIL);
  assert.equal(data.telephone, PHONE, 'the phone should be untouched');
  assert.ok(!JSON.stringify(data).includes(OWNER_EMAIL), 'no internal address in the markup');
});

// ---------------------------------------------------------------- outgoing mail

test('the quote email comes from RYDJA and replies to the business address', async () => {
  const before = mailbox.sent.length;
  const lead = await createLead('6165550182', '203.0.113.42');

  const res = await sendQuote(lead.id, '525.00');
  assert.match(res.headers.get('location'), /\?mail=sent$/);
  assert.equal(mailbox.sent.length, before + 1, 'exactly one send');

  const mail = mailbox.last();
  assert.equal(mail.from, EMAIL_FROM);
  assert.equal(mail.reply_to, BUSINESS_EMAIL, 'a reply must reach the business');
  assert.deepEqual(mail.to, ['dana@example.com'], 'and it goes to the customer, not to us');
});

test('the revised quote keeps the same From and Reply-To', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();

  await sendQuote(lead.id, '600.00');

  const mail = mailbox.last();
  assert.equal(mail.from, EMAIL_FROM);
  assert.equal(mail.reply_to, BUSINESS_EMAIL);
});

test('the scheduling email does too', async () => {
  const lead = await createLead('6165550183', '203.0.113.43');
  await sendQuote(lead.id, '450.00');
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.43' });

  const job = app.read.prepare('select * from jobs where lead_id = ?').get(lead.id);
  assert.ok(job, 'approving the quote should create a job');

  const before = mailbox.sent.length;
  await app.post(
    '/admin/jobs/' + job.id + '/propose',
    { proposed_for: '2026-11-20 09:00' },
    { headers: { cookie }, ip: '203.0.113.99' }
  );
  assert.equal(mailbox.sent.length, before + 1, 'proposing a time should send one email');

  const mail = mailbox.last();
  assert.equal(mail.from, EMAIL_FROM);
  assert.equal(mail.reply_to, BUSINESS_EMAIL);
});

test('no customer mail is ever addressed back to the business', async () => {
  for (const mail of mailbox.sent) {
    assert.deepEqual(mail.to, ['dana@example.com'], 'every send goes to the customer');
    assert.ok(!mail.to.includes(OWNER_EMAIL), 'and never to the owner address');
  }
});

// ------------------------------------------------- configuration, in isolation

test('CONTACT_EMAIL still works as the old name for the same thing', async () => {
  const legacy = await startServer({
    SITE_URL,
    BUSINESS_PHONE: PHONE,
    CONTACT_EMAIL: 'legacy@getrydja.com'
  });

  try {
    const doc = await legacy.get('/privacy').then((r) => r.text());
    assert.ok(doc.includes('mailto:legacy@getrydja.com'), 'the fallback should still publish');
  } finally {
    legacy.stop();
  }
});

test('BUSINESS_EMAIL wins when both names are set', async () => {
  const both = await startServer({
    SITE_URL,
    BUSINESS_PHONE: PHONE,
    BUSINESS_EMAIL,
    CONTACT_EMAIL: 'legacy@getrydja.com'
  });

  try {
    const doc = await both.get('/privacy').then((r) => r.text());
    assert.ok(doc.includes('mailto:' + BUSINESS_EMAIL));
    assert.ok(!doc.includes('legacy@getrydja.com'), 'the old name must not win');
  } finally {
    both.stop();
  }
});

test('with no business email configured, no address and no Reply-To appear', async () => {
  const stub = await startMailStub();
  const bare = await startServer({
    SITE_URL,
    BUSINESS_PHONE: PHONE,
    EMAIL_FROM,
    RESEND_API_KEY: 're_test_key_not_a_real_one',
    RESEND_API_BASE: stub.url,
    OWNER_EMAIL
  });

  try {
    // The legal pages fall back to the phone number alone.
    const doc = await bare.get('/privacy').then((r) => r.text());
    assert.doesNotMatch(doc, /mailto:/, 'no address configured means no mailto link');
    assert.ok(!doc.includes(OWNER_EMAIL), 'and certainly not the owner address');

    // And the structured data simply omits the field.
    const home = await bare.get('/').then((r) => r.text());
    const data = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.ok(!('email' in data), 'no email field rather than an empty one');

    // An empty reply_to would override the From address, so it must be absent
    // from the payload entirely rather than present and blank.
    const adminCookie = await bare.adminCookie();
    await bare.post(
      '/quote',
      submission({ phone: '6165550184', email: 'dana@example.com', form_stamp: await freshStamp(bare) }),
      { ip: '203.0.113.44' }
    );
    const lead = bare.read.prepare('select * from leads order by id desc limit 1').get();
    await bare.post(
      '/admin/leads/' + lead.id + '/quote',
      { amount: '450.00', notes: '' },
      { headers: { cookie: adminCookie }, ip: '203.0.113.99' }
    );

    const mail = stub.last();
    assert.ok(mail, 'the quote email should still have been sent');
    assert.equal(mail.from, EMAIL_FROM, 'mail still goes out');
    assert.ok(!('reply_to' in mail), 'no Reply-To key at all when unconfigured');
  } finally {
    bare.stop();
    stub.close();
  }
});

// ---------------------------------------------------------------- the internal address

test('OWNER_EMAIL is still recorded on the operator, untouched', async () => {
  const owner = app.read.prepare("select * from operators where role = 'owner' order by id limit 1").get();
  assert.ok(owner, 'there should be an owner operator');
  assert.equal(owner.email, OWNER_EMAIL, 'the internal record keeps the owner address');
  assert.equal(owner.name, 'Joshua Malone');
});

test('the admin can still read a lead, and the workflow is unchanged', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  const res = await app.get('/admin/leads/' + lead.id, { headers: { cookie } });
  assert.equal(res.status, 200);

  const doc = await res.text();
  // The customer's own address is still offered to the owner as a mailto --
  // that is the admin, not a public page, and it is how the owner replies.
  assert.ok(doc.includes('dana@example.com'), 'the admin still shows the customer address');
});
