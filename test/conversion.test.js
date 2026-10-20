'use strict';

// The conversion path, measured rather than assumed.
//
// Everything in here guards one change: the quote form was asking a customer
// to scroll past three optional sections -- a street address they do not need
// to give, and four scheduling controls -- before reaching the photo upload
// and the submit button. Nobody should have to plan an appointment in order to
// find out what a job costs.
//
// The collapse is <details>, deliberately, and the load-bearing property of
// that choice is what most of this file checks: the inputs are real inputs in
// the DOM whether the section was ever opened or not, so a closed section
// still posts everything typed into it, the server-side validation is
// untouched, and the form behaves identically with JavaScript blocked.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, freshStamp, submission } = require('./helpers');

const SITE = 'https://getrydja.com';
const PHONE = '1-616-929-3360';
const { SERVICE_PAGES } = require('../content/service-pages');

let app;
let cookie;

test.before(async () => {
  app = await startServer({ SITE_URL: SITE, BUSINESS_PHONE: PHONE });
  cookie = await app.adminCookie();
});

test.after(() => app?.stop());

const html = async (url, headers) => (await app.get(url, { headers })).text();
const at = (doc, needle) => doc.indexOf(needle);

/** A date n days from today, as the form submits it: bare YYYY-MM-DD. */
function daysOut(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

/** A fresh lead from a posted form, as the database stored it. */
async function submitLead(fields, ip) {
  const res = await app.post(
    '/quote',
    submission({ form_stamp: await freshStamp(app), ...fields }),
    { ip }
  );
  assert.equal(res.status, 302, 'submission should be accepted');
  assert.equal(res.headers.get('location'), '/quote/sent');
  return app.read.prepare('select * from leads order by id desc limit 1').get();
}

// ------------------------------------------------- the shape of the form

test('the things we actually need come before the things we do not', async () => {
  const doc = await html('/quote');

  // Required first, in the order a customer can answer them, then the two
  // fields that decide whether we can price the job at all.
  // Scoped to the form: <meta name="description"> is earlier in the document
  // and is not a field anybody fills in.
  const form = doc.slice(at(doc, '<form class="quote-form"'), at(doc, '</form>'));
  const order = ['name="name"', 'name="phone"', 'name="zip"', 'name="service"',
                 'name="description"', 'name="photos"'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(at(form, order[i - 1]) < at(form, order[i]),
      order[i - 1] + ' should come before ' + order[i]);
  }

  // The photo upload is the single most useful thing on the form, and it now
  // sits directly under the description rather than below three optional
  // sections. Everything optional comes after it.
  const photos = at(form, 'name="photos"');
  for (const optional of ['name="address"', 'name="city"', 'name="state"',
                          'name="preferred_date_1"', 'name="scheduling_note"']) {
    assert.ok(photos < at(form, optional), 'photos should come before ' + optional);
  }

  // And the hazard acknowledgement is still the last thing before the button,
  // because it is the one box a customer must tick knowingly.
  assert.ok(at(form, 'name="hazard_ack"') < at(form, 'type="submit"'));
  assert.ok(at(form, 'name="preferred_date_1"') < at(form, 'name="hazard_ack"'));
});

test('the optional sections are collapsed, labelled optional, and are real HTML', async () => {
  const doc = await html('/quote');
  const form = doc.slice(at(doc, '<form class="quote-form"'), at(doc, '</form>'));

  const sections = [...form.matchAll(/<details([^>]*)>\s*<summary>([\s\S]*?)<\/summary>/g)];
  assert.equal(sections.length, 2, 'two optional sections: the address and the scheduling preferences');

  for (const [, attrs, summary] of sections) {
    assert.ok(!/\bopen\b/.test(attrs), 'a fresh form opens neither section');
    assert.match(summary, /optional/i, 'a collapsed section must say it is optional: ' + summary.trim());
  }

  const [address, scheduling] = sections.map((s) => s[2]);
  assert.match(address, /Where is the property\?/);
  assert.match(scheduling, /When would you like us to come\?/);

  // No script is required for any of it. The reveal is the browser's own.
  assert.doesNotMatch(form, /data-collapse|aria-expanded|onclick/,
    'the collapse must be <details>, not a widget this site has to maintain');
});

test('nothing inside a collapsed section is required', async () => {
  const doc = await html('/quote');
  const form = doc.slice(at(doc, '<form class="quote-form"'), at(doc, '</form>'));

  for (const [, body] of form.matchAll(/<details[^>]*>([\s\S]*?)<\/details>/g)) {
    assert.doesNotMatch(body, /<(?:input|select|textarea)[^>]*\srequired/,
      'a customer must never have to open a section to submit the form');
  }

  // The five things that genuinely are required, still are.
  for (const field of ['name', 'phone', 'zip', 'service', 'description']) {
    assert.match(form, new RegExp('<(?:input|select|textarea)[^>]*name="' + field + '"[^>]*', 'g'),
      field + ' should still be on the form');
  }
  assert.match(form, /name="hazard_ack"[^>]*required|required[^>]*name="hazard_ack"/,
    'the hazard acknowledgement is required');
});

test('email and street address are still optional, and say so', async () => {
  const doc = await html('/quote');
  const form = doc.slice(at(doc, '<form class="quote-form"'), at(doc, '</form>'));

  for (const field of ['email', 'address', 'city', 'state']) {
    const tag = form.match(new RegExp('<input[^>]*name="' + field + '"[^>]*>'))[0];
    assert.doesNotMatch(tag, /\srequired/, field + ' must stay optional');
  }
  // ZIP carries the location requirement instead, and the form says so.
  assert.match(form, /<input required name="zip"/);
  assert.match(form, /ZIP above is enough for a price/);
});

// --------------------------------------- a collapsed section still submits

test('a closed scheduling section still posts every preference typed into it', async () => {
  const lead = await submitLead(
    {
      phone: '6165550701',
      preferred_date_1: daysOut(20),
      preferred_window_1: 'afternoon',
      preferred_date_2: daysOut(21),
      preferred_window_2: 'morning',
      scheduling_flexible: '1',
      scheduling_note: 'After 3 PM is easiest.'
    },
    '203.0.113.210'
  );

  assert.equal(lead.pref_date_1, daysOut(20));
  assert.equal(lead.pref_window_1, 'afternoon');
  assert.equal(lead.pref_date_2, daysOut(21));
  assert.equal(lead.pref_window_2, 'morning');
  assert.equal(lead.scheduling_flexible, 1);
  assert.equal(lead.scheduling_note, 'After 3 PM is easiest.');
});

test('a closed address section still posts the address typed into it', async () => {
  const lead = await submitLead(
    { phone: '6165550702', address: '44 Maple St', city: 'Lowell', state: 'MI' },
    '203.0.113.211'
  );

  assert.equal(lead.address, '44 Maple St');
  assert.equal(lead.city, 'Lowell');
  assert.equal(lead.state, 'MI');
});

test('a lead with nothing optional filled in is still a perfectly good lead', async () => {
  const bare = await app.post(
    '/quote',
    {
      form_stamp: await freshStamp(app),
      name: 'Pat Vale',
      phone: '6165550703',
      zip: '49331',
      service: 'Junk / hauling',
      description: 'One couch and a broken treadmill in the garage. Both can go.',
      hazard_ack: '1'
    },
    { ip: '203.0.113.212' }
  );
  assert.equal(bare.status, 302);
  assert.equal(bare.headers.get('location'), '/quote/sent');

  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  assert.equal(lead.address, null);
  assert.equal(lead.city, null);
  assert.equal(lead.pref_date_1, null);
  assert.equal(lead.scheduling_flexible, 0);
  assert.equal(lead.scheduling_note, null);
  assert.ok(lead.public_token && lead.work_ref, 'and it is a real lead with a reference');
});

test('a rejected submission reopens the sections it was carrying values in', async () => {
  // The failure this guards: a validation error that appears to have thrown
  // away what somebody typed, because it came back inside a closed section.
  const future = daysOut(30);
  const res = await app.post(
    '/quote',
    submission({
      form_stamp: await freshStamp(app),
      phone: '', // the error
      address: '44 Maple St',
      preferred_date_1: future,
      scheduling_note: 'Gate code is on the sign.'
    }),
    { ip: '203.0.113.213' }
  );
  assert.equal(res.status, 400);

  const doc = await res.text();
  const sections = [...doc.matchAll(/<details([^>]*)>\s*<summary>([\s\S]*?)<\/summary>/g)];
  assert.equal(sections.length, 2);
  for (const [, attrs, summary] of sections) {
    assert.match(attrs, /\bopen\b/, 'should reopen: ' + summary.trim());
  }

  // And the values are genuinely still in the inputs.
  // Order-tolerant: the field also carries an autocomplete attribute now,
  // and which attribute the template writes first is not what is being
  // tested here -- that the typed value came back is.
  assert.match(doc, /name="address"[^>]*value="44 Maple St"/);
  assert.match(doc, new RegExp('name="preferred_date_1"[^>]*value="' + future + '"'));
  assert.match(doc, /Gate code is on the sign\./);
});

test('the estate questions still open from a service and still store', async () => {
  const ESTATE = 'Estate / whole-property cleanout';

  // Server-rendered open, which is what makes the reveal work with no script.
  const prefilled = await html('/quote?service=' + encodeURIComponent(ESTATE));
  assert.match(prefilled, /data-estate-service="[^"]*">/, 'open when the service is the estate one');
  assert.match(await html('/quote'), /data-estate-service="[^"]*" hidden>/, 'hidden otherwise');

  // The estate fieldset is not one of the two collapsed sections: it is
  // conditional on the service rather than optional-by-default, and it must
  // not have been swept into a <details> by this pass.
  const form = prefilled.slice(at(prefilled, '<form class="quote-form"'), at(prefilled, '</form>'));
  const estateAt = at(form, 'data-estate-fields');
  const detailsBefore = (form.slice(0, estateAt).match(/<details/g) || []).length;
  const closesBefore = (form.slice(0, estateAt).match(/<\/details>/g) || []).length;
  assert.equal(detailsBefore, closesBefore, 'the estate fieldset must not sit inside a collapsed section');

  const lead = await submitLead(
    {
      phone: '6165550704',
      service: ESTATE,
      estate_areas: 'Garage',
      estate_scope: 'Whole house',
      estate_deadline: 'empty before the closing on the 14th'
    },
    '203.0.113.214'
  );
  assert.equal(lead.service, ESTATE);
  assert.equal(lead.estate_areas, 'Garage');
  assert.equal(lead.estate_scope, 'Whole house');
  assert.equal(lead.estate_deadline, 'empty before the closing on the 14th');
});

// ------------------------------------------------- every page can start one

test('every public page offers both ways to start, and a service page prefills', async () => {
  const pages = ['/', '/services', '/service-area', '/property-professionals',
                 ...SERVICE_PAGES.map((p) => '/' + p.slug)];

  for (const path of pages) {
    const doc = await html(path);
    assert.match(doc, /href="\/quote/, path + ' must offer a quote');
    assert.ok(doc.includes('href="tel:+16169293360"'), path + ' must offer the phone');
  }

  for (const page of SERVICE_PAGES) {
    const doc = await html('/' + page.slug);
    assert.ok(
      doc.includes('/quote?service=' + encodeURIComponent(page.quoteService)),
      '/' + page.slug + ' should prefill ' + page.quoteService
    );
  }
});

// ---------------------------------------------------------- the mobile bar

test('the mobile bar offers three real actions, each doing what it says', async () => {
  const doc = await html('/');
  const open = at(doc, '<nav class="mobile-cta"');
  const bar = doc.slice(open, doc.indexOf('</nav>', open));
  assert.ok(bar.length > 0, 'the homepage should carry the bar');

  // The defect this replaced: one link headed "Call or Text" pointing at
  // tel:. Tapping it starts a call on every platform and offers no way to
  // send a message, so a third of the label was simply untrue.
  assert.ok(!/Call or Text/i.test(bar), 'a tel: link must never be labelled as texting too');

  const links = [...bar.matchAll(/<a class="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links.map((l) => l[0]), ['mobile-cta-call', 'mobile-cta-text', 'mobile-cta-quote']);

  const [call, text, quote] = links.map((l) => l[1]);
  assert.ok(call.startsWith('tel:'), 'Call must be a tel: URI, got ' + call);
  assert.ok(text.startsWith('sms:'), 'Text must be an sms: URI, got ' + text);
  assert.equal(quote, '/quote');

  // Both reach the same number, from the same configured source, in the form
  // iOS and Android both accept.
  assert.equal(call, 'tel:+16169293360');
  assert.equal(text, 'sms:+16169293360');
  assert.equal(call.slice(4), text.slice(4), 'call and text must not drift apart');

  // No pre-filled body: the separator differs between platforms and there is
  // no spelling that works everywhere.
  assert.ok(!text.includes('?') && !text.includes('&'), 'no body parameter: ' + text);

  assert.match(bar, /aria-label="Contact RYDJA"/);
  for (const label of ['Call', 'Text', 'Free Quote']) {
    assert.ok(bar.includes('<strong>' + label + '</strong>'), 'the bar should offer ' + label);
  }

  // Nothing to dismiss, nothing to remember, no script.
  assert.doesNotMatch(bar, /onclick|data-dismiss|<button/);
  // The class, wherever it sits in the tag: the body also carries the
  // measurement page name now, and the order of attributes is not the point.
  assert.match(doc, /<body[^>]*class="has-mobile-cta"/);
});

test('nothing anywhere still labels a tel: link as texting', async () => {
  // Swept once, then pinned. There were thirteen of these.
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  const pages = ['/', '/services', '/service-area', '/property-professionals', '/quote',
                 '/terms', '/privacy', '/accessibility',
                 ...SERVICE_PAGES.map((p) => '/' + p.slug)];
  if (lead) pages.push('/q/' + lead.public_token);

  for (const path of pages) {
    const doc = await html(path);
    const body = doc.slice(at(doc, '<body'));

    // The misleading phrasing, in any casing.
    assert.ok(!/call or text/i.test(body), path + ' still says "call or text" beside a tel: link');

    // Wherever a tel: link exists on a public page, the same number is also
    // offered as sms: -- so "text us" is always a real option, not a label.
    if (/href="tel:/.test(body)) {
      const tel = body.match(/href="tel:([^"]+)"/)[1];
      assert.ok(body.includes('href="sms:' + tel + '"'),
        path + ' offers a phone number but no way to text it');
    }
  }
});

test('the call and text links are built from one configured number', async () => {
  // Not two hardcoded values that can drift. Change the number, both move.
  const other = await startServer({ SITE_URL: SITE, BUSINESS_PHONE: '(616) 555-0123' });
  try {
    const doc = await (await other.get('/')).text();
    assert.ok(doc.includes('href="tel:+16165550123"'), 'call should normalise to E.164');
    assert.ok(doc.includes('href="sms:+16165550123"'), 'text should normalise identically');
    assert.ok(!doc.includes('6169293360'), 'no stale hardcoded number anywhere');
  } finally {
    other.stop();
  }

  // And with no number configured, neither link exists at all.
  const quiet = await startServer({ SITE_URL: SITE, BUSINESS_PHONE: '' });
  try {
    const doc = await (await quiet.get('/')).text();
    assert.ok(!doc.includes('href="tel:'), 'no number means no tel: link');
    assert.ok(!doc.includes('href="sms:'), 'nor a dead sms: link');
  } finally {
    quiet.stop();
  }
});

test('the bar is a mobile-only overlay that reserves its own space', async () => {
  const css = await (await app.get('/styles.css')).text();

  // Hidden by default; only the mobile media query turns it on. A fixed bar on
  // a desktop page is clutter, and the sticky header CTA is enough there.
  assert.match(css, /\.mobile-cta\{display:none\}/, 'hidden until the mobile breakpoint');

  const mobile = css.slice(css.indexOf('@media(max-width:860px){', css.indexOf('.mobile-cta{display:none}')));
  assert.match(mobile, /\.mobile-cta\{[^}]*position:fixed/, 'fixed to the bottom on mobile');
  assert.match(mobile, /body\.has-mobile-cta\{padding-bottom:/,
    'the page must reserve the bar height so it covers no content');
  assert.match(mobile, /env\(safe-area-inset-bottom\)/, 'and clear a phone home indicator');
});

test('the bar never appears on a private page or on the form it points at', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();

  for (const [path, headers] of [
    ['/quote', {}],
    ['/quote/sent', {}],
    ['/q/' + lead.public_token, {}],
    ['/admin/login', {}],
    ['/admin/dashboard', { cookie }],
    ['/admin/leads', { cookie }],
    ['/admin/jobs', { cookie }],
    ['/admin/leads/' + lead.id, { cookie }]
  ]) {
    const doc = await html(path, headers);
    assert.doesNotMatch(doc, /class="mobile-cta"/, path + ' must not carry the mobile bar');
    assert.doesNotMatch(doc, /has-mobile-cta/, path + ' must not reserve space for it either');
  }
});

test('with no phone number configured the bar is not rendered at all', async () => {
  const quiet = await startServer({ SITE_URL: SITE, BUSINESS_PHONE: '' });
  try {
    const doc = await (await quiet.get('/')).text();
    assert.doesNotMatch(doc, /class="mobile-cta"/, 'no number means no bar, not an empty one');
    assert.doesNotMatch(doc, /has-mobile-cta/);
    assert.doesNotMatch(doc, /href="tel:"/, 'and certainly not a dead tel: link');
  } finally {
    quiet.stop();
  }
});

// ------------------------------------------------------------- attribution

test('a tagged link still attributes the lead the reordered form produces', async () => {
  // The form moved; the first-touch cookie did not. A visitor who lands on a
  // service page from a campaign and submits from /quote is still credited to
  // the campaign.
  const landing = await app.get('/junk-removal?utm_source=google&utm_medium=cpc&utm_campaign=junk-oct');
  const cookies = landing.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  assert.ok(cookies.includes('ps_attr'), 'the landing page should set the attribution cookie');

  const form = await app.get('/quote', { headers: { cookie: cookies } });
  const stamp = (await form.text()).match(/name="form_stamp" value="([^"]+)"/)[1];

  const res = await app.post(
    '/quote',
    submission({ form_stamp: stamp, phone: '6165550705' }),
    { ip: '203.0.113.215', headers: { cookie: cookies } }
  );
  assert.equal(res.status, 302);

  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  assert.equal(lead.source, 'google');
  assert.equal(lead.utm_source, 'google');
  assert.equal(lead.campaign, 'junk-oct');
  assert.equal(lead.landing_path, '/junk-removal');
});
