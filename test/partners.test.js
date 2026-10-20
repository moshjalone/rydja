'use strict';

// The referral engine: who we are talking to, and what it produced.
//
// Three things are being held in place.
//
// The first is attribution. A partner's link has to credit that partner, it
// has to keep crediting them when the customer comes back a week later, and
// the number on their page has to be the leads they actually sent -- because
// that number is what the owner will use to decide whether any of this is
// worth his time.
//
// The second is that nothing sends anything. There is no mail, no queue, no
// scheduler anywhere in this feature, and the test asserts the absence rather
// than trusting it: a "send" button added here later would be a different
// product with different law attached to it.
//
// The third is the usual one. A partner's details are business contact
// information and belong in the admin; none of it may reach a public page,
// and a URL somebody typed into a field may not become a javascript: link.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, freshStamp, submission } = require('./helpers');

const partners = require('../partners');
const attribution = require('../attribution');

const SITE_URL = 'https://getrydja.com';
const BUSINESS_EMAIL = 'quotes@getrydja.com';
const PHONE = '1-616-929-3360';

let app;
let mailbox;
let cookie;

/** A mail stub, here only so that "nothing was sent" can be asserted. */
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
    server.listen(0, '127.0.0.1', () =>
      resolve({ sent, url: 'http://127.0.0.1:' + server.address().port, close: () => server.close() })
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
    OWNER_NAME: 'Joshua Malone',
    RESEND_API_KEY: 're_test_key_not_a_real_one',
    RESEND_API_BASE: mailbox.url
  });
  cookie = await app.adminCookie();
});

test.after(() => {
  app?.stop();
  mailbox?.close();
});

const adminOpts = () => ({ headers: { cookie }, ip: '203.0.113.99' });
const one = (sql, ...args) => app.read.prepare(sql).get(...args);
const html = async (url, headers) => (await app.get(url, { headers })).text();

/** Add a partner through the form, and return the row. */
async function addPartner(fields = {}) {
  const res = await app.post(
    '/admin/partners',
    { name: 'Flat River Estate Sales', kind: 'estate_sale', city: 'Lowell', ...fields },
    adminOpts()
  );
  assert.equal(res.status, 302, 'adding a partner should redirect to them');
  const id = Number(res.headers.get('location').split('/').pop());
  return one('select * from partners where id = ?', id);
}

/**
 * A lead that arrived through a partner's link, the way a browser produces
 * one: land on the referral URL, keep the cookie it hands back, then post the
 * form carrying that cookie.
 */
async function leadVia(code, ip, extra = {}) {
  const landing = await app.get(code ? '/?ref=' + code : '/', { headers: { 'x-forwarded-for': ip } });
  const attr = landing.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

  const stamp = await freshStamp(app);
  const res = await app.post('/quote', submission({ ...extra, form_stamp: stamp }), {
    ip,
    headers: { cookie: attr }
  });
  assert.equal(res.status, 302, 'the submission should be accepted');
  return one('select * from leads order by id desc limit 1');
}

// ------------------------------------------------- codes

test('a referral code is short, unambiguous and unique', async () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const code = partners.randomCode();
    assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTWXYZ]{5}$/, 'the readable alphabet only');
    // No 0/O, 1/I/L, U/V: these get read down a phone and written on cards.
    assert.doesNotMatch(code, /[01OILUV]/, 'no characters that survive being read aloud badly: ' + code);
    seen.add(code);
  }
  assert.ok(seen.size > 190, 'codes must not repeat themselves this readily');
});

test('a code off a URL is normalised, and anything else is no code at all', () => {
  assert.equal(partners.normalizeCode('k7m2q'), 'K7M2Q', 'typed in lower case off a card');
  assert.equal(partners.normalizeCode('  K7M2Q  '), 'K7M2Q', 'pasted with whitespace');

  for (const junk of ['', '   ', 'K7M2', 'K7M2QQ', 'K0M2Q', 'K7M2!', '<script>', null, undefined,
                      42, { toString: () => 'K7M2Q' }, 'DROP TABLE']) {
    assert.equal(partners.normalizeCode(junk), null, 'must not become a code: ' + String(junk));
  }
});

test('every partner is given a code when they are added', async () => {
  const partner = await addPartner({ name: 'Rogue River Storage', kind: 'storage_facility' });
  assert.match(partner.referral_code, /^[23456789ABCDEFGHJKMNPQRSTWXYZ]{5}$/);

  // A partner with no code is a contact list entry: nothing they send can be
  // credited to them, which is the whole point of the feature.
  assert.equal(one('select count(*) as n from partners where referral_code is null').n, 0);
});

// ------------------------------------------------- attribution

test('a lead that arrives through a partner link is credited to that partner', async () => {
  const partner = await addPartner({ name: 'Grand River Auctions', kind: 'auctioneer' });
  const lead = await leadVia(partner.referral_code, '198.51.100.120');

  assert.equal(lead.referral_code, partner.referral_code);
  // 'partner' and not 'referral': those mean different things, and conflating
  // them would lose the only figure this feature exists to produce.
  assert.equal(lead.source, 'partner');
  assert.equal(attribution.sourceLabel('partner'), 'Partner');

  const produced = partners.leadsFor(app.read, partner.referral_code);
  assert.equal(produced.length, 1);
  assert.equal(produced[0].work_ref, lead.work_ref);
});

test('a lead with no partner link is credited to nobody', async () => {
  const lead = await leadVia(null, '198.51.100.121');
  assert.equal(lead.referral_code, null, 'no code means no partner, never a guessed one');
  assert.notEqual(lead.source, 'partner');
});

test('a code nothing matches is stored as nothing', async () => {
  const lead = await leadVia('ZZZZZ', '198.51.100.122');
  // The shape is valid, so it is stored -- and it matches no partner, which is
  // the honest outcome. What must not happen is it being counted for somebody.
  for (const row of app.read.prepare('select referral_code from partners').all()) {
    assert.notEqual(row.referral_code, lead.referral_code);
  }
  assert.equal(partners.leadsFor(app.read, 'ZZZZZ').length, 1, 'recorded, and attached to no partner');
});

test('a crafted ref parameter cannot put anything in the lead table', async () => {
  for (const hostile of ['<script>alert(1)</script>', "'; drop table leads; --",
                         'a'.repeat(500), '../../etc/passwd', '%00']) {
    const lead = await leadVia(encodeURIComponent(hostile), '198.51.100.123');
    assert.equal(lead.referral_code, null, 'must be refused: ' + hostile.slice(0, 24));
  }
  // The table is still there.
  assert.ok(one('select count(*) as n from leads').n > 0);
});

test('a partner link overrides a visit that was already attributed', async () => {
  const partner = await addPartner({ name: 'Montcalm Property Group', kind: 'property_manager' });
  const ip = '198.51.100.124';

  // A visitor who browsed the site a while ago, from a search engine.
  const first = await app.get('/junk-removal', {
    headers: { 'x-forwarded-for': ip, referer: 'https://www.google.com/search?q=junk+removal' }
  });
  const stale = first.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(stale.includes('ps_attr'), 'the first visit was attributed');

  // The same browser, sent back later by a partner.
  const second = await app.get('/?ref=' + partner.referral_code, {
    headers: { 'x-forwarded-for': ip, cookie: stale }
  });
  const rewritten = second.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(rewritten.includes('ps_attr'), 'a partner code rewrites the attribution');

  const lead = await (async () => {
    const stamp = await freshStamp(app);
    const res = await app.post('/quote', submission({ form_stamp: stamp }), {
      ip,
      headers: { cookie: rewritten }
    });
    assert.equal(res.status, 302);
    return one('select * from leads order by id desc limit 1');
  })();

  assert.equal(lead.referral_code, partner.referral_code, 'the partner who sent them gets the credit');
  assert.equal(lead.source, 'partner');
});

test("a partner's own link clicked twice does not rewrite anything", async () => {
  const partner = await addPartner({ name: 'Ionia Senior Moves', kind: 'senior_move' });
  const ip = '198.51.100.125';

  const first = await app.get('/?ref=' + partner.referral_code, { headers: { 'x-forwarded-for': ip } });
  const carried = first.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.ok(carried.includes('ps_attr'));

  // Same code, same browser. Nothing new to record, so nothing is written --
  // otherwise the thirty days would slide forward on every click.
  const second = await app.get('/?ref=' + partner.referral_code, {
    headers: { 'x-forwarded-for': ip, cookie: carried }
  });
  assert.equal(second.headers.getSetCookie().length, 0, 'an identical code must not rewrite the cookie');
});

test('a search visit still does not rewrite a stored one', async () => {
  const ip = '198.51.100.126';
  const first = await app.get('/', { headers: { 'x-forwarded-for': ip } });
  const carried = first.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

  // First-touch still wins for everything that is an inference rather than a
  // deliberate act by a third party. This is the rule the partner override is
  // the one exception to, and it has to stay the rule.
  const second = await app.get('/junk-removal', {
    headers: { 'x-forwarded-for': ip, cookie: carried, referer: 'https://www.google.com/' }
  });
  assert.equal(second.headers.getSetCookie().length, 0, 'a referrer must not overwrite a stored visit');
});

// ------------------------------------------------- the pages

test('the partner pages are admin-only', async () => {
  const partner = await addPartner({ name: 'Private Co' });
  for (const path of ['/admin/partners', '/admin/partners/' + partner.id]) {
    const res = await app.get(path);
    assert.equal(res.status, 302, path);
    assert.match(res.headers.get('location'), /\/admin\/login/);
  }
  // And the writes.
  for (const path of ['/admin/partners', '/admin/partners/' + partner.id + '/touch',
                      '/admin/partners/' + partner.id + '/edit',
                      '/admin/partners/' + partner.id + '/archive']) {
    const res = await app.post(path, { name: 'x', summary: 'x' }, { ip: '203.0.113.50' });
    assert.equal(res.status, 302, path);
    assert.match(res.headers.get('location'), /\/admin\/login/, path + ' must require a sign-in');
  }
});

test('the partner page shows the link, the draft, and what it produced', async () => {
  const partner = await addPartner({
    name: 'Lowell Estate Services',
    kind: 'estate_sale',
    contact_name: 'Sue Harmon',
    city: 'Lowell'
  });
  await leadVia(partner.referral_code, '198.51.100.130');

  const doc = await html('/admin/partners/' + partner.id, { cookie });

  assert.ok(doc.includes('Lowell Estate Services'));
  assert.ok(doc.includes(SITE_URL + '/?ref=' + partner.referral_code), 'the link to hand over');
  assert.ok(doc.includes(partner.referral_code), 'and the code on its own, to read aloud');

  // What it produced, which is the number the whole feature exists for.
  assert.match(doc, /Leads<\/span><strong>1<\/strong>/);

  // The draft, addressed to the contact and written for the kind of business.
  assert.ok(doc.includes('Hi Sue,'), 'the draft uses their first name');
  assert.ok(doc.includes('Joshua Malone'), 'and signs with the owner');
  assert.match(doc, /nobody bought/, 'and says the thing an estate-sale company cares about');

  // noindex like the rest of the admin, and not measured.
  assert.match(doc, /<meta name="robots" content="noindex,nofollow">/);
  assert.ok(!doc.includes('data-track'));
});

test('the draft claims nothing the business has not verified', async () => {
  const business = {
    brand: 'RYDJA',
    phone: PHONE,
    email: BUSINESS_EMAIL,
    siteUrl: SITE_URL,
    area: 'Lowell, Stanton and surrounding West Michigan communities',
    ownerName: 'Joshua Malone'
  };

  for (const k of partners.KINDS) {
    const draft = partners.outreachDraft({ kind: k.value, contact_name: 'Sam Reed', city: 'Lowell' }, business);
    const text = (draft.subject + '\n' + draft.body).toLowerCase();

    for (const claim of ['licensed', 'insured', 'bonded', 'certified', 'accredited',
                         'same day', 'same-day', 'guaranteed', 'cheapest', 'lowest price',
                         'best in', 'award', '5-star', 'five star', 'years of experience',
                         'free estimate', 'no risk', 'act now', 'limited time']) {
      assert.ok(!text.includes(claim), k.value + ' draft must not claim: ' + claim);
    }

    // No price, because every job is quoted individually.
    assert.doesNotMatch(text, /\$\s?\d/, k.value + ' draft must carry no price');

    // It must offer a way out. A first message that does not is the one that
    // makes an enemy in a market where everybody knows everybody.
    assert.match(draft.body, /rather I did not follow up/, k.value + ' draft must offer an opt-out');

    // And it must say the one thing that makes this business safe to refer:
    // we are not buying the contents.
    assert.match(draft.body, /not an estate buyer/, k.value + ' draft must disclaim buying contents');

    assert.ok(draft.subject.length > 10 && draft.subject.length < 120, k.value + ' subject length');
    assert.ok(!/\n/.test(draft.subject), k.value + ' subject must be one line');
  }
});

test('each kind of partner gets a different reason, in a different subject', () => {
  const business = { brand: 'RYDJA', area: 'West Michigan', ownerName: 'Joshua Malone' };
  const drafts = partners.KINDS.map((k) =>
    partners.outreachDraft({ kind: k.value, contact_name: null, city: null }, business)
  );

  // A draft that is the same for everybody is a mail merge, which is the thing
  // this is explicitly not.
  assert.equal(new Set(drafts.map((d) => d.subject)).size, drafts.length, 'subjects must differ');
  assert.equal(new Set(drafts.map((d) => d.body)).size, drafts.length, 'bodies must differ');
  assert.equal(new Set(partners.KINDS.map((k) => k.why)).size, partners.KINDS.length, 'reasons must differ');
});

// ------------------------------------------------- nothing is sent

test('nothing in this feature sends anything to anybody', async () => {
  const before = mailbox.sent.length;

  const partner = await addPartner({ name: 'Nobody Gets Mailed Ltd', email: 'them@example.com' });
  await app.post('/admin/partners/' + partner.id + '/touch', {
    channel: 'email',
    direction: 'out',
    summary: 'Emailed them from my own mailbox.'
  }, adminOpts());
  await app.post('/admin/partners/' + partner.id + '/edit', {
    name: 'Nobody Gets Mailed Ltd',
    status: 'talking'
  }, adminOpts());
  await html('/admin/partners/' + partner.id, { cookie });
  await html('/admin/partners', { cookie });

  assert.equal(mailbox.sent.length, before, 'the referral engine must send nothing, ever');

  // And there is no send button to press, in either direction.
  const doc = await html('/admin/partners/' + partner.id, { cookie });
  assert.ok(!/action="[^"]*send/i.test(doc), 'no form posts to anything called send');
  assert.doesNotMatch(doc, /<button[^>]*>\s*Send/i, 'no send button');
  assert.match(doc, /Nothing here sends anything/i, 'and the page says so where somebody would look');
});

// ------------------------------------------------- logging the work

test('logging a contact records it and moves a prospect along', async () => {
  const partner = await addPartner({ name: 'Belding Rentals', kind: 'property_manager' });
  assert.equal(partner.status, 'prospect');

  const res = await app.post('/admin/partners/' + partner.id + '/touch', {
    channel: 'phone',
    direction: 'out',
    summary: 'Rang the office. Left a message with the manager.',
    next_step: 'Ring back',
    happened_on: '2026-10-19'
  }, adminOpts());
  assert.equal(res.status, 302);

  const touch = one('select * from partner_touches where partner_id = ? order by id desc limit 1', partner.id);
  assert.equal(touch.channel, 'phone');
  assert.equal(touch.direction, 'out');
  assert.equal(touch.happened_on, '2026-10-19', 'a date in the past is a valid record of a call');
  assert.match(touch.summary, /Left a message/);

  // Having just written down that he contacted them, the owner should not also
  // have to remember to change a dropdown.
  assert.equal(one('select status from partners where id = ?', partner.id).status, 'contacted');
  assert.equal(one('select next_step from partners where id = ?', partner.id).next_step, 'Ring back');
});

test('an inbound contact reads as a conversation', async () => {
  const partner = await addPartner({ name: 'Six Lakes Cleaning', kind: 'cleaning' });
  await app.post('/admin/partners/' + partner.id + '/touch', {
    channel: 'phone',
    direction: 'in',
    summary: 'They rang us about a unit they cannot clean until it is emptied.'
  }, adminOpts());

  assert.equal(one('select status from partners where id = ?', partner.id).status, 'talking');
});

test('a touch with nothing in it is not recorded', async () => {
  const partner = await addPartner({ name: 'Empty Log Co' });
  const before = one('select count(*) as n from partner_touches').n;

  for (const summary of ['', '   ']) {
    const res = await app.post('/admin/partners/' + partner.id + '/touch', {
      channel: 'email',
      summary
    }, adminOpts());
    assert.equal(res.status, 302);
  }
  assert.equal(one('select count(*) as n from partner_touches').n, before, 'an empty log entry is not a record');
});

test('a junk channel, direction or stage falls back rather than being stored', async () => {
  const partner = await addPartner({ name: 'Junk Fields Co' });
  await app.post('/admin/partners/' + partner.id + '/touch', {
    channel: 'carrier-pigeon',
    direction: 'sideways',
    status: 'enlightened',
    summary: 'Something happened.'
  }, adminOpts());

  const touch = one('select * from partner_touches where partner_id = ? order by id desc limit 1', partner.id);
  assert.ok(partners.CHANNEL_VALUES.includes(touch.channel), 'channel fell back to a real one');
  assert.ok(partners.DIRECTIONS.includes(touch.direction), 'direction fell back');
  assert.ok(
    partners.STATUS_VALUES.includes(one('select status from partners where id = ?', partner.id).status),
    'stage fell back'
  );
});

test('what is due is listed, and nothing reminds anybody', async () => {
  const partner = await addPartner({ name: 'Due Today Co' });
  const today = require('../analytics').localDay();

  await app.post('/admin/partners/' + partner.id + '/touch', {
    channel: 'email',
    summary: 'Emailed. Chase in a bit.',
    next_step: 'Chase it',
    next_step_on: today
  }, adminOpts());

  const due = partners.due(app.read, today);
  assert.ok(due.some((d) => d.id === partner.id), 'due today should be listed today');

  const list = await html('/admin/partners', { cookie });
  assert.match(list, /Due now/);
  assert.ok(list.includes('Due Today Co'));

  // The dashboard carries the count, and that is the whole of the nagging.
  const dash = await html('/admin/dashboard', { cookie });
  assert.match(dash, /Partner follow-ups due/);
});

// ------------------------------------------------- safety

test('a URL typed into a partner field cannot become a dangerous link', async () => {
  const partner = await addPartner({
    name: 'Hostile URL Co',
    website: 'javascript:alert(document.cookie)',
    source_url: 'http://insecure.example.com/listing'
  });

  // https or nothing: exactly the rule the social profile URLs get.
  assert.equal(partner.website, '', 'a javascript: URL must not be stored');
  assert.equal(partner.source_url, '', 'plain http must not be stored either');

  const doc = await html('/admin/partners/' + partner.id, { cookie });
  assert.ok(!doc.includes('javascript:alert'), 'and nothing of it reaches the page');

  const good = await addPartner({
    name: 'Fine URL Co',
    website: 'https://example.com/about?utm_source=share'
  });
  assert.match(good.website, /^https:\/\/example\.com\/about/);
  assert.ok(!good.website.includes('utm_source'), 'a share-sheet parameter is stripped like everywhere else');
});

test('a partner is archived rather than deleted, and the history survives', async () => {
  const partner = await addPartner({ name: 'Archive Me Co', kind: 'contractor' });
  await leadVia(partner.referral_code, '198.51.100.140');
  await app.post('/admin/partners/' + partner.id + '/touch', {
    channel: 'email',
    summary: 'One conversation on the record.'
  }, adminOpts());

  const res = await app.post('/admin/partners/' + partner.id + '/archive', {}, adminOpts());
  assert.equal(res.status, 302);

  const row = one('select * from partners where id = ?', partner.id);
  assert.ok(row, 'the row is still there');
  assert.ok(row.archived_at, 'and is marked archived');

  // A referral that happened stays a fact, and the lead keeps its code --
  // deleting the partner would orphan the attribution.
  assert.equal(one('select count(*) as n from partner_touches where partner_id = ?', partner.id).n, 1);
  assert.equal(partners.leadsFor(app.read, row.referral_code).length, 1);

  // Out of the list.
  const list = await html('/admin/partners', { cookie });
  assert.ok(!list.includes('Archive Me Co'), 'an archived partner leaves the list');

  // And back again.
  await app.post('/admin/partners/' + partner.id + '/archive', { restore: '1' }, adminOpts());
  assert.equal(one('select archived_at from partners where id = ?', partner.id).archived_at, null);
  assert.ok((await html('/admin/partners', { cookie })).includes('Archive Me Co'));
});

test('a partner that does not exist is a 404, not a crash', async () => {
  for (const path of ['/admin/partners/99999', '/admin/partners/0', '/admin/partners/abc']) {
    const res = await app.get(path, { headers: { cookie } });
    assert.equal(res.status, 404, path);
  }
});

test('nothing about a partner reaches a public page', async () => {
  const partner = await addPartner({
    name: 'Confidential Partner Co',
    contact_name: 'Private Person',
    email: 'private@example.com',
    phone: '6165550123',
    notes: 'He does not like being rung before ten.'
  });

  for (const path of ['/', '/quote', '/services', '/service-area', '/sitemap.xml',
                      '/junk-removal-lowell-mi', '/junk-removal-stanton-mi', '/property-professionals']) {
    const doc = await html(path);
    for (const secret of ['Confidential Partner Co', 'Private Person', 'private@example.com',
                          '6165550123', 'does not like being rung', partner.referral_code]) {
      assert.ok(!doc.includes(secret), path + ' leaked: ' + secret);
    }
  }
});

test('the lead source breakdown shows Partner as its own row', async () => {
  const doc = await html('/admin/dashboard', { cookie });
  assert.match(doc, /Lead sources/);
  assert.ok(doc.includes('>Partner<'), 'partner-sourced leads are their own row, not folded into Referral');
  assert.match(doc, /src-partner/, 'and carry their own chip');
});
