'use strict';

// Estate and whole-property cleanouts: the flagship service.
//
// Two things are guarded here, and only one of them is SEO.
//
// The first is the ordinary mechanical set: the page answers, it is
// canonicalised and in the sitemap, the quote form accepts the service, the
// three new columns persist, the admin shows them, and every lead taken before
// any of this existed still renders.
//
// The second is the one that matters. This page is read by people clearing a
// house after a death, and the business has decided what it will and will not
// say to them. It will not offer to buy the contents. It will not claim to know
// what anything is worth. It will not promise a salvage credit it has not
// agreed to, and it will not invent a right to anybody's property. Each of
// those is a test below, because "we would never write that" is not a control.
// A future copy edit is, and this is what fails it.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { startServer, freshStamp, submission } = require('./helpers');
const { servicePage, SERVICE_PAGES } = require('../content/service-pages');

const SITE = 'https://getrydja.com';
const PATH = '/estate-cleanouts';

// The exact label the form offers and the server recognises, and the one it
// replaced. Written out rather than imported, so a rename has to be a
// deliberate edit in two places instead of a silent one.
const ESTATE = 'Estate / whole-property cleanout';
const OLD_ESTATE = 'Estate cleanout';

let app;
let cookie;

test.before(async () => {
  app = await startServer({ SITE_URL: SITE, BUSINESS_PHONE: '1-616-929-3360' });
  cookie = await app.adminCookie();
});

test.after(() => app?.stop());

const html = async (url, headers) => (await app.get(url, { headers })).text();
const meta = (doc, re) => { const m = doc.match(re); return m ? m[1] : null; };
const bodyText = (doc) =>
  doc.slice(doc.indexOf('<main'), doc.indexOf('</main>')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Form fields as a list of pairs, so a checkbox group submits the way a
 * browser submits one. An object would stringify the array into a single
 * comma-joined value, which is not what the server receives in real life.
 */
function pairs(fields) {
  const out = [];
  for (const [key, value] of Object.entries(fields)) {
    for (const one of [].concat(value)) out.push([key, String(one)]);
  }
  return out;
}

/** A lead submitted through the real form, returned as its database row. */
async function submitLead(fields, opts = {}) {
  const body = pairs({ ...submission(fields), form_stamp: await freshStamp(app) });
  const res = await app.post('/quote', body, { ip: opts.ip || '203.0.113.150' });
  assert.equal(res.status, 302, 'the submission should have been accepted');
  return app.read.prepare('select * from leads order by id desc limit 1').get();
}

const adminPage = async (url) => (await app.get(url, { headers: { cookie } })).text();

// ---------------------------------------------------------------- the page

test('/estate-cleanouts answers 200 with one h1 and the title we meant', async () => {
  const res = await app.get(PATH);
  assert.equal(res.status, 200);

  const doc = await res.text();
  assert.equal((doc.match(/<h1[\s>]/g) || []).length, 1);
  assert.equal(meta(doc, /<title>([^<]*)<\/title>/), 'Estate Cleanouts in West Michigan | RYDJA');
  assert.doesNotMatch(doc, /name="robots"/, 'the flagship page must be indexable');
});

test('the canonical is clean, and no campaign parameter can get into it', async () => {
  // The link we hand out on Facebook, verbatim from the brief.
  const tagged = PATH + '?utm_source=facebook&utm_medium=social&utm_campaign=estate-cleanouts';

  for (const url of [PATH, tagged, PATH + '?utm_source=google&gclid=abc123', PATH + '?fbclid=xyz']) {
    const doc = await html(url);
    assert.equal(meta(doc, /<link rel="canonical" href="([^"]+)"/), SITE + PATH, url);
    assert.equal(meta(doc, /property="og:url" content="([^"]+)"/), SITE + PATH, url);
    assert.doesNotMatch(doc, /rel="canonical" href="[^"]*[?&]/, 'the canonical carries no query string');
    assert.ok(!doc.includes('utm_'), url + ' must not echo a campaign parameter into the page');
  }
});

test('a trailing slash redirects rather than becoming a second URL', async () => {
  const res = await app.get(PATH + '/');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), PATH);
});

test('the page is in the sitemap, and leads the service pages', async () => {
  const xml = await (await app.get('/sitemap.xml')).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  assert.ok(locs.includes(SITE + PATH), 'the flagship page belongs in the sitemap');
  assert.equal(
    locs.indexOf(SITE + PATH),
    locs.indexOf(SITE + '/services') + 1,
    'it should sit at the head of the service pages'
  );
  assert.equal(locs.filter((l) => l.startsWith(SITE + PATH)).length, 1, 'one entry, not two');
  assert.doesNotMatch(xml, /utm_/, 'a campaign URL is not a canonical URL');
});

test('the page says what the service actually covers', async () => {
  const text = bodyText(await html(PATH)).toLowerCase();

  // The jobs the brief asked to attract, in the words a customer would use.
  for (const term of ['estate cleanout', 'inherited', 'whole-house', 'downsizing', 'relocation',
                      'barn', 'basement', 'attic', 'garage', 'outbuilding', 'before sale',
                      'landlord', 'property manager', 'executor']) {
    assert.ok(text.includes(term), 'the page should cover ' + term);
  }

  // And the photo-first path, which is the only intake the business has.
  assert.ok(text.includes('send photographs'), 'photos come first');

  const words = text.split(' ').length;
  assert.ok(words > 900, 'the flagship page should be substantial; it is ' + words + ' words');
});

test('there is a strong CTA near the top and another at the bottom', async () => {
  const doc = await html(PATH);
  const main = doc.slice(doc.indexOf('<main'), doc.indexOf('</main>'));

  const ctas = [...main.matchAll(/<a class="button" href="(\/quote[^"]*)"/g)].map((m) => m[1]);
  assert.ok(ctas.length >= 2, 'the page needs a quote button at both ends, not just one');

  const first = main.indexOf('class="button"');
  const last = main.lastIndexOf('class="button"');
  assert.ok(first < main.length / 3, 'the first CTA is too far down the page');
  assert.ok(last > (main.length * 2) / 3, 'the last CTA is too far up the page');

  // Both prefill the form with the service the form actually offers, so the
  // extra questions are already open when the customer arrives.
  for (const cta of ctas) {
    assert.equal(cta, '/quote?service=' + encodeURIComponent(ESTATE), 'a CTA must prefill the real option');
  }
});

test('the five-step path the brief asked for is on the page, in order', async () => {
  const text = bodyText(await html(PATH)).toLowerCase();
  const steps = ['send photographs', 'which areas need clearing', 'we send a price',
                 'approve', 'we clear it'];

  let cursor = 0;
  for (const step of steps) {
    const at = text.indexOf(step, cursor);
    assert.ok(at !== -1, 'the page should name the step: ' + step);
    cursor = at;
  }
});

test('a page that writes its own steps does not also print the shared ones', async () => {
  // The two cover the same ground; one after the other reads as padding.
  const estate = bodyText(await html(PATH));
  assert.ok(!estate.includes('How the quote works'), 'the flagship writes its own path');
  assert.ok(estate.includes('How an estate cleanout runs'));

  // And every page that has no steps of its own still gets the shared one.
  for (const page of SERVICE_PAGES.filter((p) => !p.steps)) {
    const doc = bodyText(await html('/' + page.slug));
    assert.ok(doc.includes('How the quote works'), '/' + page.slug + ' lost its quote explanation');
  }
});

// ------------------------------------------------------- the sensitive part

test('the page tells the customer to identify what stays, before anything is loaded', async () => {
  const text = bodyText(await html(PATH)).toLowerCase();

  assert.ok(text.includes('set aside or clearly mark anything that is staying'),
    'the customer, not the crew, decides what stays');
  assert.ok(text.includes('we will not guess'), 'and we say plainly that we do not guess');
});

test('the legal protections are stated here too, not only in the terms', async () => {
  const doc = await html(PATH);

  // Every category the terms warn about is warned about on the page a grieving
  // family actually reads, because most of them never open /terms.
  for (const item of ['passports', 'Financial records', 'Wills', 'Family photographs',
                      'Medication', 'Firearms', 'personal data', 'Hazardous material']) {
    assert.ok(doc.includes(item), 'the page should warn about ' + item);
  }

  // And it points at the terms rather than paraphrasing them away.
  assert.match(doc, /href="\/terms#removal"/, 'the page should link the removal terms');
  assert.ok(
    bodyText(doc).includes('we remove what you designate for removal, and nothing else'),
    'the authorization framing has to survive'
  );
});

test('nothing on the page reads as an offer to buy, value or keep the contents', async () => {
  const text = bodyText(await html(PATH)).toLowerCase();

  // The predatory phrases named in the brief, and a few of their cousins.
  for (const phrase of ["we'll buy all your valuables", 'buy all your valuables', 'cash for estates',
                        'cash for your estate', 'we know what is worth money', "we know what's worth money",
                        'we buy estates', 'top dollar', 'free estate evaluation', 'we pay cash',
                        'we will make you an offer', 'we can take it off your hands for']) {
    assert.ok(!text.includes(phrase), 'the page must not say "' + phrase + '"');
  }

  // Claimed rights over somebody else's property.
  for (const overclaim of ['becomes our property', 'title passes', 'ownership transfers',
                           'transfer of ownership', 'abandoned property', 'forfeit',
                           'we decide what is worth keeping']) {
    assert.ok(!text.includes(overclaim), 'the page must not claim "' + overclaim + '"');
  }

  // And it says the opposite, out loud.
  assert.ok(text.includes('we are not buyers, dealers or appraisers'));
  assert.ok(text.includes('we do not appraise, value or purchase estate contents'));
});

test('the salvage story is told without promising a credit or an appraisal', async () => {
  const text = bodyText(await html(PATH)).toLowerCase();

  // The differentiator itself: every disposition the business actually has.
  for (const route of ['keep', 'donate', 'recycle', 'scrap', 'reuse', 'salvage', 'dispose']) {
    assert.ok(text.includes(route), 'the sorting routes should include ' + route);
  }
  assert.ok(text.includes('only where you have authorized it'),
    'recovery happens on the customer’s authority, not ours');

  // The two honest limits.
  assert.ok(text.includes('we are not appraisers'));
  assert.ok(text.includes('recovery is not a discount you are owed'));
  assert.ok(text.includes('agreed in writing on that job'), 'a credit is per-job and written down');

  // No promise of money back, and no claim to expertise we do not have.
  for (const promise of ['salvage credit on every', 'we always credit', 'guaranteed credit',
                         'we appraise', 'our appraisers', 'certified appraiser', 'free appraisal',
                         'antique experts', 'we identify valuables']) {
    assert.ok(!text.includes(promise), 'must not promise "' + promise + '"');
  }
});

test('the page invents no price, no review and no capability', async () => {
  const body = bodyText(await html(PATH));
  const text = body.toLowerCase();

  for (const claim of ['same-day', 'same day service', 'cheapest', 'lowest price',
                       'licensed and insured', 'fully insured', 'bonded', 'five-star', '5-star',
                       'years of experience', 'award-winning', 'starting at', 'per truckload',
                       'customers say', 'testimonial', 'our reviews']) {
    assert.ok(!text.includes(claim), 'the page must not claim "' + claim + '"');
  }

  assert.doesNotMatch(body, /\$\s?\d/, 'no prices on a page that quotes every job');
});

// ---------------------------------------------------------------- linking

test('the homepage gives the service prominent placement and both links', async () => {
  const doc = await html('/');

  const flagship = doc.indexOf('id="estate"');
  const grid = doc.indexOf('id="services"');
  assert.ok(flagship !== -1, 'the homepage needs the flagship band');
  assert.ok(flagship < grid, 'it belongs above the general service grid');

  const band = doc.slice(flagship, grid);
  assert.match(band, /Estate &amp; whole-property cleanouts/);
  assert.match(band, /One room or an entire property/);
  assert.match(band, /Get an Estate Cleanout Quote/);
  assert.match(band, /href="\/estate-cleanouts"/, 'the band should link the page');
  assert.ok(
    band.includes('/quote?service=' + encodeURIComponent(ESTATE)),
    'and prefill the form with the option the form offers'
  );

  // The existing homepage survives it: the hero is untouched and every other
  // service is still linked.
  assert.match(doc, /Point at the problem/);
  assert.match(doc, /class="hero-slogan"/);
  for (const page of SERVICE_PAGES) {
    assert.match(doc, new RegExp('href="/' + page.slug + '"'), 'homepage should still link /' + page.slug);
  }
});

test('the services page carries it as a major card, ahead of the smaller work', async () => {
  const doc = await html('/services');

  const estate = doc.indexOf('Estate &amp; Whole-Property Cleanouts');
  assert.ok(estate !== -1, 'the services page needs the card');
  for (const smaller of ['Junk &amp; Hauling', 'Light Demo', 'Other Jobs']) {
    assert.ok(estate < doc.indexOf(smaller), 'the flagship card should come before ' + smaller);
  }

  const card = doc.slice(estate - 500, estate + 900);
  assert.match(card, /href="\/estate-cleanouts"/, 'the card should link the dedicated page');
  assert.ok(card.includes('/quote?service=' + encodeURIComponent(ESTATE)), 'and prefill a quote');
});

test('the service area mentions estate work without widening the coverage claim', async () => {
  const doc = await html('/service-area');

  assert.match(doc, /href="\/estate-cleanouts"/);
  assert.match(bodyText(doc), /settling an estate/i);

  // The area itself still comes from configuration and nothing else.
  const configured = await startServer({
    SITE_URL: SITE,
    SERVICE_AREA: 'Testville and the surrounding Test County area',
    SERVICE_AREA_PLACES: 'Testville, Michigan|Test County'
  });
  try {
    const page = await (await configured.get('/service-area')).text();
    assert.match(page, /href="\/estate-cleanouts"/, 'the estate link is not tied to one area');
    assert.ok(!page.includes('Lowell'), 'no second hardcoded area list crept in');
  } finally {
    configured.stop();
  }
});

test('the related-work links point both ways between the big and small jobs', async () => {
  const page = servicePage('estate-cleanouts');
  assert.ok(page, 'the page should exist as content');

  const doc = await html(PATH);
  for (const rel of page.related) {
    assert.match(doc, new RegExp('href="' + rel.href + '"'), PATH + ' should link ' + rel.href);
  }
  assert.ok(!page.related.some((r) => r.href === PATH), 'a page must not be its own related work');

  // And the space-sized cleanout page offers the property-sized one.
  assert.match(await html('/cleanouts'), /href="\/estate-cleanouts"/);
});

// ---------------------------------------------------------- structured data

test('the page carries Service and BreadcrumbList data, and fabricates nothing', async () => {
  const doc = await html(PATH);
  const blocks = [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]));

  const service = blocks.find((b) => b['@type'] === 'Service');
  assert.ok(service, 'the flagship page needs Service data');
  assert.equal(service.url, SITE + PATH);
  assert.equal(service.serviceType, 'Estate Cleanouts');
  assert.equal(service.provider['@id'], SITE + '/#business');
  for (const invented of ['offers', 'price', 'priceRange', 'aggregateRating', 'review']) {
    assert.ok(!(invented in service), 'Service data must not invent ' + invented);
  }

  const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList');
  assert.ok(crumbs, 'and breadcrumbs');
  assert.equal(crumbs.itemListElement.at(-1).item, SITE + PATH);

  // The business node offers it too, at the head of the catalog.
  const home = JSON.parse(
    (await html('/')).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]
  );
  const offered = home.hasOfferCatalog.itemListElement.map((o) => o.itemOffered.url);
  assert.equal(offered[0], SITE + PATH, 'the flagship leads the offer catalog');
  assert.ok(home.knowsAbout.includes('estate cleanouts'));
  assert.ok(home.knowsAbout.includes('whole house cleanouts'));
  // Named once each, not repeated to pad the list.
  assert.equal(new Set(home.knowsAbout).size, home.knowsAbout.length);
});

// ---------------------------------------------------------------- the form

test('the quote form offers the service, and the estate page prefills it', async () => {
  const plain = await html('/quote');
  assert.ok(plain.includes('<option>' + ESTATE + '</option>'), 'the option should be on the list');
  assert.ok(!plain.includes('>' + OLD_ESTATE + '<'), 'the old, narrower label should be gone');

  // Arriving from the estate page: the service is selected and the extra
  // questions are already open, with no JavaScript involved.
  const prefilled = await html('/quote?service=' + encodeURIComponent(ESTATE));
  assert.ok(prefilled.includes('<option selected>' + ESTATE + '</option>'), 'the service should be selected');
  assert.match(prefilled, /data-estate-service="[^"]*">/, 'the estate fields should be open');

  // Arriving cold: the same fields are rendered, but out of the way.
  assert.match(plain, /data-estate-service="[^"]*" hidden>/, 'hidden until asked for');

  // And the toggle has something to read the label off, rather than a copy of
  // the string baked into the script.
  const js = await (await app.get('/app.js')).text();
  assert.match(js, /data-estate-service/);
  assert.ok(!js.includes(ESTATE), 'the label must not be duplicated into the front end');
});

test('the estate questions are the ones asked for, and none of them is required', async () => {
  const doc = await html('/quote?service=' + encodeURIComponent(ESTATE));
  const fieldset = doc.slice(doc.indexOf('data-estate-fields'), doc.indexOf('When would you like us to come?'));
  assert.ok(fieldset.length > 200 && fieldset.length < 4000, 'the fieldset slice looks wrong');

  for (const area of ['House', 'Garage', 'Basement', 'Attic', 'Barn', 'Shed/outbuildings', 'Yard', 'Other']) {
    assert.ok(fieldset.includes('value="' + area + '"'), 'the areas should include ' + area);
  }
  for (const scope of ['A few rooms', 'Most of the house', 'Whole house',
                       'Whole property / multiple buildings', 'Not sure']) {
    assert.ok(fieldset.includes(scope), 'the scopes should include ' + scope);
  }
  assert.match(fieldset, /Is there a deadline, closing date or move-out date\?/);
  // The word itself appears in the copy ("useful rather than required"), so
  // this asserts on the attribute: no control in here may be mandatory. Nobody
  // inventories a house they have just inherited.
  assert.doesNotMatch(fieldset, /<(?:input|select|textarea)[^>]*\srequired/, 'nothing here may be required');

  // The form did not grow an inventory table, and the photo upload is still
  // the prominent thing on it.
  assert.doesNotMatch(doc, /inventory|itemize|itemise|list every item/i);
  const upload = doc.indexOf('name="photos"');
  assert.ok(upload !== -1 && upload < doc.indexOf('type="submit"'), 'the photo upload stays above the button');
  assert.match(doc, /Up to 12 photos/);
});

test('an estate submission stores the areas, the scope and the deadline', async () => {
  const lead = await submitLead({
    phone: '6165550201',
    service: ESTATE,
    description: 'Mother’s house in Lowell. House, garage and the barn out back all need clearing.',
    estate_areas: ['House', 'Garage', 'Barn'],
    estate_scope: 'Whole property / multiple buildings',
    estate_deadline: 'Closing is on the 14th, so it has to be empty before then'
  }, { ip: '203.0.113.151' });

  assert.equal(lead.service, ESTATE);
  // Stored in our order, not the browser's.
  assert.equal(lead.estate_areas, 'House, Garage, Barn');
  assert.equal(lead.estate_scope, 'Whole property / multiple buildings');
  assert.equal(lead.estate_deadline, 'Closing is on the 14th, so it has to be empty before then');

  // And everything that was true of a lead before is still true of this one.
  assert.equal(lead.public_token.length, 32);
  assert.match(lead.work_ref, /^RYDJA-[0-9A-Z]{6}$/);
  assert.equal(lead.status, 'new');
  assert.equal((await app.get('/q/' + lead.public_token)).status, 200);
});

test('an estate lead with none of the extra answers is still a valid lead', async () => {
  const lead = await submitLead({
    phone: '6165550202',
    service: ESTATE,
    description: 'Inherited a house and have no idea where to start. Happy to talk it through.'
  }, { ip: '203.0.113.152' });

  assert.equal(lead.service, ESTATE);
  assert.equal(lead.estate_areas, null);
  assert.equal(lead.estate_scope, null);
  assert.equal(lead.estate_deadline, null);
  assert.equal(lead.status, 'new');

  // The admin says so rather than showing a row of dashes.
  const detail = await adminPage('/admin/leads/' + lead.id);
  assert.match(detail, /class="badge estate"/, 'it is still visibly an estate job');
  assert.match(detail, /no areas or scope given/, 'and the owner is told what to ask');
});

test('only the listed areas and scopes are stored, whatever the form sends', async () => {
  const lead = await submitLead({
    phone: '6165550203',
    service: ESTATE,
    description: 'Tampered form: the areas and scope below are not on our lists.',
    estate_areas: ['House', 'Swimming pool', '<script>alert(1)</script>'],
    estate_scope: 'Whole continent',
    estate_deadline: 'x'.repeat(500)
  }, { ip: '203.0.113.153' });

  assert.equal(lead.estate_areas, 'House', 'anything off the list is dropped, not stored');
  assert.equal(lead.estate_scope, null, 'a scope we do not offer is not a scope');
  assert.equal(lead.estate_deadline.length, 200, 'and free text is capped like every other field');

  // Whatever was sent, nothing executable reaches the admin page.
  const detail = await adminPage('/admin/leads/' + lead.id);
  assert.ok(!detail.includes('<script>alert(1)</script>'));
});

test('a non-estate lead never carries estate detail, even if the fields are sent', async () => {
  const lead = await submitLead({
    phone: '6165550204',
    service: 'Yard / brush cleanup',
    description: 'Brush pile at the back of the lot, plus a few bags of leaves.',
    estate_areas: ['House', 'Barn'],
    estate_scope: 'Whole house',
    estate_deadline: 'next Friday'
  }, { ip: '203.0.113.154' });

  assert.equal(lead.service, 'Yard / brush cleanup');
  assert.equal(lead.estate_areas, null);
  assert.equal(lead.estate_scope, null);
  assert.equal(lead.estate_deadline, null);

  const detail = await adminPage('/admin/leads/' + lead.id);
  assert.ok(!detail.includes('class="badge estate"'), 'and it is not badged as one');
  assert.ok(!detail.includes('Estate / whole-property scope'));
});

test('leads taken before these questions existed are untouched and still render', async () => {
  const lead = await submitLead({ phone: '6165550205' }, { ip: '203.0.113.155' });
  assert.equal(lead.service, 'Garage / basement cleanout', 'the default submission is not an estate job');

  assert.equal(lead.estate_areas, null, 'no backfill: they were never asked');
  assert.equal(lead.estate_scope, null);
  assert.equal(lead.estate_deadline, null);

  const detail = await adminPage('/admin/leads/' + lead.id);
  assert.ok(!detail.includes('Estate / whole-property scope'), 'nothing empty is shown for them');
  assert.ok(!detail.includes('class="badge estate"'), 'nor a badge they never earned');
  assert.equal((await app.get('/q/' + lead.public_token)).status, 200, 'their own page still works');
});

// ---------------------------------------------------------------- the admin

test('an estate lead is obvious in the admin, with its scope on the detail page', async () => {
  const lead = await submitLead({
    phone: '6165550206',
    service: ESTATE,
    description: 'Executor for my aunt’s estate. The whole house plus the attic and the shed.',
    estate_areas: ['House', 'Attic', 'Shed/outbuildings'],
    estate_scope: 'Whole house',
    estate_deadline: 'Listing photographs are booked for the 20th'
  }, { ip: '203.0.113.156' });

  const detail = await adminPage('/admin/leads/' + lead.id);
  assert.match(detail, /<span class="badge estate">Estate cleanout<\/span>/, 'the badge the owner looks for');
  assert.match(detail, /Estate \/ whole-property scope/);
  assert.ok(detail.includes('House, Attic, Shed/outbuildings'), 'the areas');
  assert.ok(detail.includes('Whole house'), 'the scope');
  assert.ok(detail.includes('Listing photographs are booked for the 20th'), 'the deadline');

  // The workflow around it is untouched: quoting is still the next step, and
  // approval, scheduling and the job all still hang off it.
  assert.match(detail, new RegExp('action="/admin/leads/' + lead.id + '/quote"'));
  assert.match(detail, /Send quote/);
  assert.match(detail, /Propose an appointment/);

  const inbox = await adminPage('/admin/leads');
  assert.match(inbox, /<span class="badge estate">Estate<\/span>/, 'and it is flagged in the inbox');
});

test('an estate lead still runs the whole quote to job workflow', async () => {
  const lead = await submitLead({
    phone: '6165550210',
    service: ESTATE,
    description: 'Whole property, house and pole barn. Ready whenever you are.',
    estate_areas: ['House', 'Barn'],
    estate_scope: 'Whole property / multiple buildings'
  }, { ip: '203.0.113.160' });

  const quoted = await app.post(
    '/admin/leads/' + lead.id + '/quote',
    pairs({ amount: '2400', notes: 'Three loads, two days, disposal included.' }),
    { ip: '203.0.113.160', headers: { cookie } }
  );
  assert.equal(quoted.status, 302);

  // The customer approves from their own page, exactly as before.
  const approved = await app.post(
    '/q/' + lead.public_token + '/respond',
    pairs({ decision: 'approve' }),
    { ip: '203.0.113.160' }
  );
  assert.equal(approved.status, 302);

  const job = app.read
    .prepare('select j.* from jobs j where j.lead_id = ?')
    .get(lead.id);
  assert.ok(job, 'approving an estate quote creates a job like any other');
  assert.equal(job.status, 'unscheduled');
  assert.equal(job.customer_total_cents, 240000);

  // And the estate detail is still on the lead the job came from.
  const after = app.read.prepare('select * from leads where id = ?').get(lead.id);
  assert.equal(after.estate_areas, 'House, Barn');
  assert.equal(after.status, 'converted');
});

test('a lead carrying the old label is still recognised as estate work', async () => {
  // Leads taken before the relabel say 'Estate cleanout'. They must not go
  // quiet in the admin, so the recognition covers both spellings.
  //
  // Written as a database the app has never seen and then booted against,
  // which is the same shape as the migration suite and keeps one writer on the
  // file at a time -- handing a live server's database to a second handle
  // loses to Windows and its WAL lock.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rydja-estate-legacy-'));
  const dbPath = path.join(dir, 'legacy.db');

  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`
    pragma journal_mode = wal;
    create table operators (id integer primary key autoincrement, name text not null, phone text, email text,
      role text not null default 'owner', active integer not null default 1, created_at text not null default (datetime('now')));
    create table customers (id integer primary key autoincrement, name text not null, phone text not null unique,
      email text, created_at text not null default (datetime('now')));
    create table leads (id integer primary key autoincrement, customer_id integer not null references customers(id),
      public_token text not null unique, service text not null, description text not null, address text, city text,
      state text, zip text not null, access text, timing text, status text not null default 'new',
      created_at text not null default (datetime('now')));
    create table lead_photos (id integer primary key autoincrement, lead_id integer not null references leads(id),
      filename text not null, created_at text not null default (datetime('now')));
    create table quotes (id integer primary key autoincrement, lead_id integer not null references leads(id),
      amount_cents integer not null, notes text, status text not null default 'sent',
      created_at text not null default (datetime('now')), responded_at text);
    create table jobs (id integer primary key autoincrement, lead_id integer not null references leads(id),
      quote_id integer not null references quotes(id), operator_id integer not null references operators(id),
      status text not null default 'unscheduled', scheduled_for text, customer_total_cents integer not null,
      started_at text, completed_at text, created_at text not null default (datetime('now')));
    create table job_expenses (id integer primary key autoincrement, job_id integer not null references jobs(id),
      category text not null, amount_cents integer not null, weight_lbs real, note text,
      created_at text not null default (datetime('now')));
    create table salvage_items (id integer primary key autoincrement, job_id integer not null references jobs(id),
      title text not null, disposition text not null default 'resell', estimated_value_cents integer not null default 0,
      realized_value_cents integer, notes text, created_at text not null default (datetime('now')));
    create table job_photos (id integer primary key autoincrement, job_id integer not null references jobs(id),
      phase text not null, filename text not null, created_at text not null default (datetime('now')));

    insert into operators (name, role) values ('Owner', 'owner');
    insert into customers (name, phone) values ('Old Executor', '6165559100');
    insert into leads (customer_id, public_token, service, description, zip, status)
      values (1, 'cccccccccccccccccccccccccccccccc', 'Estate cleanout',
              'An estate job taken before the relabel.', '49503', 'new');
  `);
  legacy.close();

  const migrated = await startServer({ SITE_URL: SITE, DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'uploads') });
  try {
    const lead = migrated.read.prepare('select * from leads order by id limit 1').get();
    assert.equal(lead.service, OLD_ESTATE, 'the old label is left exactly as it was');
    assert.equal(lead.estate_areas, null, 'and no answer is invented for a question never asked');
    assert.equal(lead.estate_scope, null);
    assert.equal(lead.estate_deadline, null);

    const admin = await migrated.adminCookie();
    const detail = await (await migrated.get('/admin/leads/' + lead.id, { headers: { cookie: admin } })).text();
    assert.ok(detail.includes(OLD_ESTATE), 'the admin shows the label the customer was given');
    assert.match(detail, /class="badge estate"/, 'and it is still badged as estate work');
    assert.match(detail, /no areas or scope given/, 'with a nudge to ask for the rest');

    const inbox = await (await migrated.get('/admin/leads', { headers: { cookie: admin } })).text();
    assert.match(inbox, /<span class="badge estate">Estate<\/span>/);

    // Their own link is untouched by any of this.
    assert.equal((await migrated.get('/q/' + 'c'.repeat(32))).status, 200);
  } finally {
    migrated.stop();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows may still hold the wal file; the temp dir is disposable */
    }
  }
});

// ---------------------------------------------------------------- privacy

test('the public page leaks nothing private, and the new fields never go public', async () => {
  const lead = await submitLead({
    phone: '6165550208',
    name: 'Priya Raman',
    service: ESTATE,
    description: 'Private detail that belongs only in the admin.',
    estate_areas: ['House'],
    estate_scope: 'Whole house',
    estate_deadline: 'Before the closing on the 3rd'
  }, { ip: '203.0.113.158' });

  for (const page of [PATH, '/', '/services', '/quote', '/service-area', '/sitemap.xml']) {
    const doc = await html(page);
    for (const secret of [lead.public_token, 'Priya Raman', '6165550208',
                          'Before the closing on the 3rd', 'Private detail that belongs']) {
      assert.ok(!doc.includes(secret), page + ' must not expose ' + secret.slice(0, 22));
    }
  }

  // The customer's own page is not indexable, estate fields or not.
  const own = await html('/q/' + lead.public_token);
  assert.match(own, /<meta name="robots" content="noindex,nofollow">/);
  assert.doesNotMatch(own, /rel="canonical"/);

  // And nothing about the lead reached the log beyond the public reference.
  const log = app.logs();
  assert.ok(!log.includes('Priya Raman'));
  assert.ok(!log.includes('6165550208'));
  assert.ok(!log.includes(lead.public_token));
  assert.ok(!log.includes('Before the closing on the 3rd'));
});

// ---------------------------------------------------------------- tracking

test('a tagged estate link attributes the lead it produces', async () => {
  // The campaign URL from the brief, start to finish.
  const landing = await app.get(
    PATH + '?utm_source=facebook&utm_medium=social&utm_campaign=estate-cleanouts'
  );
  assert.equal(landing.status, 200);

  const jar = landing.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  assert.match(jar, /ps_attr=/, 'the visit should be remembered');

  // They read the page, click the CTA, and send the form.
  const form = await (await app.get('/quote?service=' + encodeURIComponent(ESTATE), {
    headers: { cookie: jar }
  })).text();
  assert.ok(form.includes('<option selected>' + ESTATE + '</option>'));

  const res = await app.post('/quote', pairs({
    ...submission({
      phone: '6165550209',
      service: ESTATE,
      description: 'Came in from the Facebook estate campaign. Whole house and the garage.',
      estate_areas: ['House', 'Garage'],
      estate_scope: 'Whole house'
    }),
    form_stamp: form.match(/name="form_stamp" value="([^"]+)"/)[1]
  }), { ip: '203.0.113.159', headers: { cookie: jar } });
  assert.equal(res.status, 302);

  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  assert.equal(lead.source, 'facebook');
  assert.equal(lead.medium, 'social');
  assert.equal(lead.campaign, 'estate-cleanouts');
  assert.equal(lead.landing_path, PATH, 'the path only, never the query');
  assert.equal(lead.estate_areas, 'House, Garage');
  assert.equal(lead.estate_scope, 'Whole house');

  // The admin can see where it came from, next to the estate badge.
  const detail = await adminPage('/admin/leads/' + lead.id);
  assert.match(detail, /class="badge estate"/);
  assert.match(detail, /estate-cleanouts/, 'the campaign name');
});
