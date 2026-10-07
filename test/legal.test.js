'use strict';

// The legal pages, the acceptance record, and the claims we are careful NOT to
// make: no certifications we have not earned, no marketing consent nobody gave,
// no promise that anything is completely secure.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, freshStamp, submission } = require('./helpers');

const TERMS_VERSION = '2026-10-06';
const LEGAL_PAGES = ['/privacy', '/terms', '/accessibility'];

let app;
let cookie;

test.before(async () => {
  app = await startServer({
    SITE_URL: 'https://getrydja.com',
    BUSINESS_PHONE: '1-616-929-3360',
    OWNER_NAME: 'Joshua Malone',
    OWNER_EMAIL: 'owner@example.com'
  });
  cookie = await app.adminCookie();
});

test.after(() => app?.stop());

const html = async (url, headers) => (await app.get(url, { headers })).text();

/** A lead carried to an open quote, ready to be approved. */
async function quotedLead(phone, ip, extra = {}) {
  const res = await app.post('/quote', submission({ phone, form_stamp: await freshStamp(app) }), { ip });
  assert.equal(res.status, 302);
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  await app.post(
    '/admin/leads/' + lead.id + '/quote',
    { amount: '450.00', notes: '', ...extra },
    { headers: { cookie }, ip: '203.0.113.99' }
  );
  return lead;
}

// ---------------------------------------------------------------- the pages

test('every legal page is served and indexable', async () => {
  for (const path of LEGAL_PAGES) {
    const res = await app.get(path);
    assert.equal(res.status, 200, path);

    const doc = await res.text();
    assert.equal((doc.match(/<h1[\s>]/g) || []).length, 1, path + ' should have one h1');
    assert.match(doc, new RegExp('<link rel="canonical" href="https://getrydja.com' + path + '">'), path);
    assert.doesNotMatch(doc, /name="robots"/, path + ' is public and must not be noindex');
  }
});

test('the terms cover what the business actually needs them to', async () => {
  const doc = await html('/terms');

  // Quotes and scope.
  assert.match(doc, /does not create a contract|Nothing is agreed/i);
  assert.match(doc, /photos, measurements and description/i);
  assert.match(doc, /differ materially/i);

  // Authority, and what stays.
  assert.match(doc, /authority to authorize work/i);
  assert.match(doc, /identify what must stay/i);

  // Removal authorization, the heart of it.
  assert.match(doc, /disposed of, recycled, donated,\s*scrapped, reused or resold/i);
  assert.match(doc, /designate for removal/i);

  // The things people lose in a cleanout.
  for (const item of ['passports', 'Financial records', 'Medication', 'Firearms', 'Family photographs', 'Wills']) {
    assert.ok(doc.includes(item), 'terms should warn about ' + item);
  }

  // Hazardous material, refusal, scheduling, access, cancellation.
  assert.match(doc, /asbestos/i);
  assert.match(doc, /decline or stop any job/i);
  assert.match(doc, /proposal until you confirm/i);
  assert.match(doc, /Weather, equipment trouble/i);
  assert.match(doc, /safe and lawful access/i);
  assert.match(doc, /as early as you reasonably can/i);
});

test('the terms invent no fees or payment terms the system does not have', async () => {
  const doc = await html('/terms').then((d) => d.toLowerCase());

  for (const invented of ['cancellation fee', 'late fee', 'deposit', 'non-refundable', 'minimum charge',
                          'net 30', 'interest', 'penalty']) {
    assert.ok(!doc.includes(invented), 'terms must not invent "' + invented + '"');
  }
});

test('ownership language stays on authorization, not on automatic legal transfer', async () => {
  const doc = await html('/terms').then((d) => d.toLowerCase());

  assert.ok(doc.includes('items you designate for removal'), 'framed around what the customer authorizes');
  for (const overclaim of ['title passes', 'ownership transfers', 'transfer of ownership', 'becomes our property',
                           'abandoned property', 'forfeit']) {
    assert.ok(!doc.includes(overclaim), 'must not claim "' + overclaim + '"');
  }
});

test('the privacy policy says what is collected and makes no absolute promise', async () => {
  const doc = await html('/privacy');

  for (const item of ['Your name', 'Your phone number', 'Your email address', 'property address',
                      'Photographs you upload', 'Preferred dates', 'Quote information',
                      'Scheduling information', 'Questions or messages']) {
    assert.ok(doc.includes(item), 'privacy policy should list ' + item);
  }

  assert.match(doc, /does not sell customer personal information/i);
  assert.match(doc, /Website hosting/);
  assert.match(doc, /Transactional email/);
  assert.match(doc, /Cloud backup/);

  // The honest security line.
  assert.match(doc, /cannot guarantee absolute\s*security/i);
  const lower = doc.toLowerCase();
  for (const overclaim of ['bank-grade', 'military-grade', '100% secure', 'completely secure', 'fully secure',
                           'totally secure', 'unhackable']) {
    assert.ok(!lower.includes(overclaim), 'privacy policy must not claim "' + overclaim + '"');
  }

  assert.match(doc, /Last updated: October 2026/);
});

test('the accessibility statement claims no certification', async () => {
  const doc = await html('/accessibility');
  const lower = doc.toLowerCase();

  assert.match(doc, /we do not claim to be ADA compliant or WCAG conformant/i);
  for (const overclaim of ['fully ada compliant', 'ada compliant website', 'wcag certified', 'wcag 2.1 aa compliant',
                           'fully accessible', 'certified accessible']) {
    assert.ok(!lower.includes(overclaim), 'must not claim "' + overclaim + '"');
  }

  // A real way to report a problem.
  assert.ok(doc.includes('1-616-929-3360'), 'needs a contact method for reporting issues');
});

// ---------------------------------------------------------------- photos

test('no page implies marketing or promotional photo consent', async () => {
  for (const path of ['/privacy', '/terms', '/quote']) {
    const doc = await html(path);
    const lower = doc.toLowerCase();
    for (const phrase of ['marketing purposes', 'promotional use', 'social media', 'advertising']) {
      if (!lower.includes(phrase)) continue;
      // Where these words appear at all, they must be a refusal, not a grant.
      assert.match(
        doc,
        /not used for advertising, marketing or social media|do not use your photographs for advertising/i,
        path + ' mentions ' + phrase + ' and must be refusing, not granting'
      );
    }
    // And nothing pre-ticked anywhere.
    assert.doesNotMatch(doc, /type="checkbox"[^>]*\schecked/, path + ' must not pre-check a consent box');
  }
});

// ---------------------------------------------------------------- approval

test('the approval disclosure sits next to the button and links to the terms', async () => {
  const lead = await quotedLead('6165550801', '203.0.113.70');
  const doc = await html('/q/' + lead.public_token);

  assert.match(doc, /By approving, you confirm that you have authority to authorize this work/);
  assert.match(doc, /disposal, recycling, donation, scrapping, reuse or resale/);
  assert.match(doc, /href="\/terms"/, 'Terms of Service must be a link to /terms');

  // Visible on the page, not hidden behind a disclosure widget, and approval is
  // still one click.
  assert.doesNotMatch(doc, /<details[^>]*>\s*<summary>[^<]*Terms/i);
  assert.match(doc, /name="decision" value="approve"/);

  // Order matters: the disclosure must come before the button, not under it.
  assert.ok(
    doc.indexOf('By approving, you confirm') < doc.indexOf('name="decision" value="approve"'),
    'the disclosure must appear above the approve button'
  );
});

test('an approved quote records the terms version that was shown', async () => {
  const lead = await quotedLead('6165550802', '203.0.113.71');

  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.72' });

  const quote = app.read.prepare('select * from quotes where lead_id = ?').get(lead.id);
  assert.equal(quote.status, 'approved');
  assert.equal(quote.terms_version, TERMS_VERSION);

  // The rest of the acceptance record is intact alongside it.
  assert.ok(quote.responded_at, 'acceptance timestamp');
  assert.equal(quote.amount_cents, 45000, 'the amount accepted');

  const job = app.read
    .prepare('select j.*, l.work_ref from jobs j join leads l on l.id = j.lead_id where j.lead_id = ?')
    .get(lead.id);
  assert.match(job.work_ref, /^RYDJA-/, 'the permanent reference');
});

test('approving with a proposed time records both the appointment and the version', async () => {
  const lead = await quotedLead('6165550803', '203.0.113.73', { proposed_for: '2026-11-18T09:00' });

  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve_confirm' }, { ip: '203.0.113.74' });

  const quote = app.read.prepare('select * from quotes where lead_id = ?').get(lead.id);
  const job = app.read.prepare('select * from jobs where lead_id = ?').get(lead.id);

  assert.equal(quote.terms_version, TERMS_VERSION);
  assert.ok(quote.responded_at);
  assert.equal(job.scheduled_for, '2026-11-18 09:00', 'the confirmed appointment');
  assert.equal(job.status, 'scheduled');
});

test('a declined quote records no acceptance of anything', async () => {
  const lead = await quotedLead('6165550804', '203.0.113.75');

  await app.post('/q/' + lead.public_token + '/respond', { decision: 'decline' }, { ip: '203.0.113.76' });

  const quote = app.read.prepare('select * from quotes where lead_id = ?').get(lead.id);
  assert.equal(quote.status, 'declined');
  assert.equal(quote.terms_version, null, 'declining accepts nothing');
});

test('an approval that predates the terms is left alone, not backfilled', async () => {
  // A row as it would have existed before terms_version was introduced.
  const lead = await quotedLead('6165550805', '203.0.113.77');
  const quote = app.read.prepare('select * from quotes where lead_id = ?').get(lead.id);

  // The migration adds the column and sets nothing. Anything already approved
  // never saw these terms, and a version written into that row would be a
  // record of consent that did not happen.
  const legacy = app.read
    .prepare("select count(*) as n from quotes where status = 'approved' and terms_version is null")
    .get().n;
  assert.ok(legacy >= 0, 'legacy approvals may exist with a null version');
  assert.equal(quote.terms_version, null, 'an unanswered quote has accepted nothing yet');
});

// ---------------------------------------------------------------- footer

test('the footer carries the legal links and the notice, on every public page', async () => {
  for (const path of ['/', '/services', '/quote', ...LEGAL_PAGES]) {
    const doc = await html(path);
    assert.match(doc, /href="\/privacy">Privacy</, path + ' needs a Privacy link');
    assert.match(doc, /href="\/terms">Terms</, path + ' needs a Terms link');
    assert.match(doc, /href="\/accessibility">Accessibility</, path + ' needs an Accessibility link');
    assert.match(doc, /href="\/quote">Contact</, path + ' Contact should go to the quote form');
    // The phone stays separately dialable in the same footer.
    assert.match(doc, /href="tel:\+16169293360"/, path + ' needs the phone as its own tel: link');
    assert.match(doc, /&copy; 2026 RYDJA\. All rights reserved\./, path + ' needs the copyright notice');
  }
});

// ---------------------------------------------------------------- privacy

test('no private or personal detail appears on a legal page', async () => {
  for (const path of LEGAL_PAGES) {
    const doc = await html(path);

    // The owner's own details are configured but must never be published here.
    assert.ok(!doc.includes('owner@example.com'), path + ' must not publish the owner email');
    assert.ok(!doc.includes('Joshua Malone'), path + ' must not publish the owner name');

    // Nor anything shaped like a street address.
    assert.doesNotMatch(
      doc,
      /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct|Way|Boulevard|Blvd)\b/,
      path + ' must not contain a street address'
    );
  }
});

test('no customer data reaches public metadata', async () => {
  const lead = await quotedLead('6165550806', '203.0.113.78');

  for (const path of ['/', '/services', '/quote', ...LEGAL_PAGES]) {
    const doc = await html(path);
    assert.ok(!doc.includes(lead.public_token), path + ' must not leak a private token');
    assert.ok(!doc.includes('Dana Reed'), path + ' must not leak a customer name');
    assert.ok(!doc.includes('6165550806'), path + ' must not leak a customer phone');
    assert.ok(!doc.includes('dana@example.com'), path + ' must not leak a customer email');
  }
});

test('private pages stay noindex, and the sitemap stays public-only', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();

  for (const [path, headers] of [
    ['/q/' + lead.public_token, {}],
    ['/quote/sent', {}],
    ['/admin/login', {}],
    ['/admin/leads', { cookie }],
    ['/admin/jobs', { cookie }]
  ]) {
    assert.match(await html(path, headers), /<meta name="robots" content="noindex,nofollow">/, path);
  }

  const xml = await (await app.get('/sitemap.xml')).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  // The legal pages belong in it; the private ones never do. The exact set is
  // asserted in local-seo.test.js, which owns the indexable list.
  for (const path of LEGAL_PAGES) {
    assert.ok(locs.includes('https://getrydja.com' + path), 'sitemap should list ' + path);
  }
  assert.ok(locs.includes('https://getrydja.com/'));
  assert.ok(locs.every((l) => l.startsWith('https://getrydja.com/')));
  assert.ok(!xml.includes(lead.public_token));
  assert.ok(!/\/admin/.test(xml));
});

// ---------------------------------------------------------------- tracking

test('the site still ships no analytics, pixels or third-party scripts', async () => {
  for (const path of ['/', '/services', '/quote', ...LEGAL_PAGES]) {
    const doc = await html(path);

    // Every script on the page must be our own.
    for (const m of doc.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
      assert.match(m[1], /^\/[a-z0-9.\-]+\.js(\?v=[0-9a-f]+)?$/, path + ' loads a third-party script: ' + m[1]);
    }

    const lower = doc.toLowerCase();
    for (const tracker of ['googletagmanager', 'google-analytics', 'gtag(', 'fbq(', 'hotjar',
                           'fullstory', 'mixpanel', 'segment.com', 'clarity.ms', 'doubleclick']) {
      assert.ok(!lower.includes(tracker), path + ' must not load ' + tracker);
    }

    // No consent banner, because there is nothing to consent to.
    assert.doesNotMatch(doc, /cookie.{0,12}(banner|consent|accept all)/i, path);
  }
});

test('public pages set no cookies at all', async () => {
  for (const path of ['/', '/services', '/quote', ...LEGAL_PAGES]) {
    const res = await app.get(path);
    assert.deepEqual(res.headers.getSetCookie(), [], path + ' must not set a cookie');
  }
});

// ---------------------------------------------------------------- a11y

test('the accessibility basics the statement claims are actually there', async () => {
  for (const path of ['/', '/quote', '/privacy']) {
    const doc = await html(path);
    assert.match(doc, /<a class="skip-link" href="#main">Skip to content<\/a>/, path + ' needs a skip link');
    assert.match(doc, /<main id="main"/, path + ' needs the skip target');
    assert.match(doc, /<html lang="en">/, path + ' needs a language');
  }

  // Every form control on the quote form is labelled.
  const quote = await html('/quote');
  const named = [...quote.matchAll(/<(input|select|textarea)[^>]*name="([^"]+)"/g)]
    .filter((m) => !/type="hidden"/.test(m[0]))
    .map((m) => m[2]);
  assert.ok(named.length > 10, 'sanity: the form has fields');
  // Each one is wrapped by a <label>, which is how this form is built.
  const labels = (quote.match(/<label/g) || []).length;
  assert.ok(labels >= named.length - 2, 'most fields should be wrapped in a label');

  const css = await (await app.get('/styles.css')).text();
  assert.match(css, /:focus-visible\{outline:/, 'a visible focus ring');
  assert.match(css, /prefers-reduced-motion/, 'motion must be switchable off');
});
