'use strict';

// The service pages, the service area page, and the review link.
//
// The assertion that matters most here is the one about duplication: seven pages
// that are one template with the nouns swapped are doorway pages, and would
// deserve to be treated as such. So this measures how different they actually
// are rather than trusting that they were written separately.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, freshStamp, submission } = require('./helpers');
const { SERVICE_PAGES } = require('../content/service-pages');

const SITE = 'https://getrydja.com';
const SERVICE_PATHS = SERVICE_PAGES.map((p) => '/' + p.slug);
const INDEXABLE = ['/', '/services', '/quote', ...SERVICE_PATHS, '/service-area',
                   '/privacy', '/terms', '/accessibility'];

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

// ---------------------------------------------------------------- the pages

test('the service pages exist and are the ones we meant to build', () => {
  assert.deepEqual(SERVICE_PATHS.slice().sort(), [
    '/cleanouts', '/estate-cleanouts', '/furniture-appliance-removal', '/hauling-moving-help',
    '/junk-removal', '/light-demolition', '/yard-cleanup'
  ]);
});

// The order of SERVICE_PAGES *is* the service hierarchy: it drives the
// homepage grid, the service-area list, the offer catalog and the sitemap.
// Estate and whole-property work is the flagship, so it comes first, and this
// is the test that notices when a later edit quietly demotes it.
test('the flagship service leads the hierarchy', () => {
  assert.equal(SERVICE_PATHS[0], '/estate-cleanouts');
});

test('every indexable page returns 200 with one h1 and a correct canonical', async () => {
  for (const path of INDEXABLE) {
    const res = await app.get(path);
    assert.equal(res.status, 200, path);

    const doc = await res.text();
    assert.equal((doc.match(/<h1[\s>]/g) || []).length, 1, path + ' needs exactly one h1');
    assert.equal(meta(doc, /<link rel="canonical" href="([^"]+)"/), SITE + path, path + ' canonical');
    assert.doesNotMatch(doc, /name="robots"/, path + ' must stay indexable');
  }
});

test('titles and descriptions are unique across every indexable page', async () => {
  const titles = [];
  const descriptions = [];

  for (const path of INDEXABLE) {
    const doc = await html(path);
    const title = meta(doc, /<title>([^<]*)<\/title>/);
    const description = meta(doc, /<meta name="description" content="([^"]+)"/);

    assert.ok(title.length > 10 && title.length <= 75, path + ' title length: ' + title.length);
    assert.ok(description.length > 50 && description.length <= 185, path + ' description length: ' + description.length);

    titles.push(title);
    descriptions.push(description);
  }

  assert.equal(new Set(titles).size, titles.length, 'duplicate titles');
  assert.equal(new Set(descriptions).size, descriptions.length, 'duplicate descriptions');
});

test('every service page carries the full Open Graph set', async () => {
  for (const path of SERVICE_PATHS) {
    const doc = await html(path);
    const title = meta(doc, /<title>([^<]*)<\/title>/);

    assert.equal(meta(doc, /property="og:title" content="([^"]+)"/), title, path);
    assert.equal(meta(doc, /property="og:url" content="([^"]+)"/), SITE + path, path);
    assert.equal(meta(doc, /property="og:type" content="([^"]+)"/), 'website', path);
    assert.ok(meta(doc, /property="og:description" content="([^"]+)"/), path + ' og:description');
    assert.equal(meta(doc, /name="twitter:card" content="([^"]+)"/), 'summary_large_image', path);
  }
});

// ------------------------------------------------------------- not doorways

test('the service pages are substantially different from one another', async () => {
  const bodies = {};
  for (const path of SERVICE_PATHS) bodies[path] = bodyText(await html(path));

  for (const [path, text] of Object.entries(bodies)) {
    const words = text.split(' ').length;
    assert.ok(words > 300, path + ' is too thin at ' + words + ' words');
  }

  // Jaccard overlap on the vocabulary of each pair. Pages that share a layout
  // and a business still land well under half; a template with the nouns
  // swapped lands near one.
  const paths = Object.keys(bodies);
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const a = new Set(bodies[paths[i]].toLowerCase().split(' '));
      const b = new Set(bodies[paths[j]].toLowerCase().split(' '));
      const shared = [...a].filter((w) => b.has(w)).length;
      const overlap = shared / (a.size + b.size - shared);
      assert.ok(overlap < 0.6, `${paths[i]} and ${paths[j]} overlap ${overlap.toFixed(2)} — too alike`);
    }
  }
});

test('no page is stuffed with its own keyword', async () => {
  for (const page of SERVICE_PAGES) {
    const text = bodyText(await html('/' + page.slug)).toLowerCase();
    const words = text.split(' ').length;

    // The head term of each page, counted as a phrase.
    const term = page.nav.toLowerCase().replace(/ & /g, ' and ');
    const hits = (text.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const density = hits / words;
    assert.ok(density < 0.03, `/${page.slug} repeats "${term}" ${hits} times in ${words} words`);
  }
});

// ---------------------------------------------------------------- linking

test('the homepage links to every service page and the service area', async () => {
  const doc = await html('/');
  for (const page of SERVICE_PAGES) {
    assert.match(doc, new RegExp('href="/' + page.slug + '"'), 'homepage should link /' + page.slug);
  }
  assert.match(doc, /href="\/service-area"/, 'homepage should link the service area');
});

test('each service page links onward to related work, the area and a quote', async () => {
  for (const page of SERVICE_PAGES) {
    const doc = await html('/' + page.slug);

    assert.match(doc, /href="\/service-area"/, '/' + page.slug + ' should link the service area');
    assert.match(doc, /href="\/quote/, '/' + page.slug + ' should link the quote form');

    for (const rel of page.related) {
      assert.match(doc, new RegExp('href="' + rel.href + '"'), '/' + page.slug + ' should link ' + rel.href);
      // Descriptive anchor text, not the bare keyword again.
      assert.ok(rel.label.split(' ').length >= 3, '/' + page.slug + ' anchor is too terse: ' + rel.label);
    }
    // And it does not link to itself as "related".
    assert.ok(!page.related.some((r) => r.href === '/' + page.slug), '/' + page.slug + ' links to itself');
  }
});

// ---------------------------------------------------------------- homepage

test('the homepage h1 says what the business does, and the slogan survives', async () => {
  const doc = await html('/');

  const h1 = doc.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)[1].replace(/<[^>]+>/g, '').trim();
  assert.match(h1, /Junk Removal/i);
  assert.match(h1, /Cleanouts/i);
  assert.match(h1, /West Michigan/i);

  // The brand line is still on the page, still prominent, and NOT the h1.
  assert.match(doc, /Point at the problem/);
  assert.match(doc, /class="hero-slogan"/);

  // No hidden-text trickery around the keyword heading.
  const css = await (await app.get('/styles.css')).text();
  const heroH1 = css.match(/\.hero-h1\{([^}]*)\}/)[1];
  for (const trick of ['display:none', 'visibility:hidden', 'font-size:0', 'text-indent:-', 'opacity:0']) {
    assert.ok(!heroH1.includes(trick), '.hero-h1 must not use ' + trick);
  }
  assert.match(heroH1, /font-size:clamp\(19px/, 'the keyword heading must be a readable size');
});

test('the homepage describes the business and explains how a job runs', async () => {
  const text = bodyText(await html('/')).toLowerCase();

  for (const term of ['junk removal', 'cleanout', 'hauling', 'yard cleanup', 'property cleanup']) {
    assert.ok(text.includes(term), 'homepage should mention ' + term);
  }

  // The four steps, matching the workflow the system actually implements.
  for (const step of ['photo', 'quote', 'approve', 'time']) {
    assert.ok(text.includes(step), 'homepage should explain the ' + step + ' step');
  }

  // Claims we have no basis for.
  for (const unsupported of ['same-day', 'same day service', 'cheapest', 'lowest price', 'licensed and insured',
                             'fully insured', 'bonded', 'five-star', '5-star', 'years of experience']) {
    assert.ok(!text.includes(unsupported), 'homepage must not claim "' + unsupported + '"');
  }
});

// ------------------------------------------------------------- service area

test('the service area page reads from the configured area, not a hardcoded list', async () => {
  const configured = await startServer({
    SITE_URL: SITE,
    SERVICE_AREA: 'Testville and the surrounding Test County area',
    SERVICE_AREA_PLACES: 'Testville, Michigan|Test County'
  });
  try {
    const doc = await (await configured.get('/service-area')).text();
    assert.match(doc, /Testville and the surrounding Test County area/);
    assert.match(doc, /Testville, Michigan/);
    assert.match(doc, /Test County/);
    // The default must not be baked in anywhere.
    assert.ok(!doc.includes('Lowell'), 'the area must come from configuration, not a second hardcoded list');
  } finally {
    configured.stop();
  }
});

test('no thin city pages were generated', async () => {
  // Only the one area page exists. Per-city pages come later, with real
  // local content behind them.
  for (const guess of ['/junk-removal-lowell', '/lowell', '/junk-removal-stanton', '/stanton',
                       '/junk-removal-near-me', '/west-michigan']) {
    assert.equal((await app.get(guess)).status, 404, guess + ' should not exist yet');
  }

  const xml = await (await app.get('/sitemap.xml')).text();
  assert.ok(!/lowell|stanton/i.test(xml), 'no city pages belong in the sitemap yet');
});

// ------------------------------------------------------------- structured data

test('structured data is valid, and still invents nothing', async () => {
  const home = await html('/');
  const business = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

  assert.equal(business['@type'], 'HomeAndConstructionBusiness');
  assert.equal(business['@id'], SITE + '/#business');
  assert.equal(business.logo, SITE + '/img/rydja-logo.jpg');
  assert.equal(business.hasOfferCatalog.itemListElement.length, SERVICE_PAGES.length);

  for (const offer of business.hasOfferCatalog.itemListElement) {
    assert.equal(offer['@type'], 'Offer');
    assert.equal(offer.itemOffered['@type'], 'Service');
    assert.match(offer.itemOffered.url, new RegExp('^' + SITE + '/'));
    // No price anywhere: every job is quoted individually.
    assert.ok(!('price' in offer) && !('priceSpecification' in offer), 'offers must carry no price');
  }

  for (const invented of ['address', 'openingHours', 'openingHoursSpecification', 'priceRange',
                          'aggregateRating', 'review', 'award']) {
    assert.ok(!(invented in business), 'must not invent ' + invented);
  }
});

test('each service page carries valid Service and BreadcrumbList data', async () => {
  for (const page of SERVICE_PAGES) {
    const doc = await html('/' + page.slug);
    const blocks = [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]));

    const service = blocks.find((b) => b['@type'] === 'Service');
    assert.ok(service, '/' + page.slug + ' needs Service data');
    assert.equal(service.url, SITE + '/' + page.slug);
    assert.equal(service.provider['@id'], SITE + '/#business', 'provider should reference the business node');
    assert.ok(!('offers' in service), 'no price on a service we quote per job');
    assert.ok(!('aggregateRating' in service) && !('review' in service), 'no fabricated ratings');

    const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList');
    assert.ok(crumbs, '/' + page.slug + ' needs breadcrumbs');
    assert.equal(crumbs.itemListElement.length, 3);
    assert.equal(crumbs.itemListElement[2].item, SITE + '/' + page.slug);
  }
});

// ---------------------------------------------------------------- sitemap

test('the sitemap holds every public page and nothing private', async () => {
  const res = await app.get('/sitemap.xml');
  assert.equal(res.status, 200);

  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  for (const path of INDEXABLE) {
    assert.ok(locs.includes(SITE + path), 'sitemap should list ' + path);
  }
  assert.equal(locs.length, INDEXABLE.length, 'sitemap should list exactly the indexable pages');

  assert.ok(!/\/admin/.test(xml));
  assert.ok(!/\/q\//.test(xml));
  assert.ok(!/quote\/sent/.test(xml));
  for (const loc of locs) assert.match(loc, /^https:\/\/getrydja\.com\//);
});

// ---------------------------------------------------------------- reviews

test('the review link appears only on a completed job, and only when configured', async () => {
  const withUrl = await startServer({
    SITE_URL: SITE,
    GOOGLE_REVIEW_URL: 'https://g.page/r/example-review-link/review'
  });
  try {
    const admin = await withUrl.adminCookie();
    const res = await withUrl.post('/quote', submission({ form_stamp: await freshStamp(withUrl) }), { ip: '203.0.113.90' });
    assert.equal(res.status, 302);
    const lead = withUrl.read.prepare('select * from leads order by id desc limit 1').get();

    await withUrl.post('/admin/leads/' + lead.id + '/quote', { amount: '400', notes: '' },
      { headers: { cookie: admin }, ip: '203.0.113.99' });
    await withUrl.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.91' });
    const job = withUrl.read.prepare('select * from jobs where lead_id = ?').get(lead.id);

    // Not offered while the work is still open.
    let doc = await (await withUrl.get('/q/' + lead.public_token)).text();
    assert.doesNotMatch(doc, /How did we do\?/, 'no review ask before the job is finished');

    for (const status of ['in_progress']) {
      await withUrl.post('/admin/jobs/' + job.id + '/status', { status },
        { headers: { cookie: admin }, ip: '203.0.113.99' });
      doc = await (await withUrl.get('/q/' + lead.public_token)).text();
      assert.doesNotMatch(doc, /How did we do\?/, 'no review ask while ' + status);
    }

    await withUrl.post('/admin/jobs/' + job.id + '/status', { status: 'complete' },
      { headers: { cookie: admin }, ip: '203.0.113.99' });
    doc = await (await withUrl.get('/q/' + lead.public_token)).text();

    assert.match(doc, /How did we do\?/, 'the ask appears once the job is complete');
    assert.match(doc, /Leave RYDJA a Google Review/);
    assert.ok(doc.includes('https://g.page/r/example-review-link/review'), 'links straight to the configured URL');
    assert.match(doc, /rel="noopener nofollow"/, 'an outbound review link should be nofollow');

    // Offered, not forced, and never bought.
    assert.doesNotMatch(doc, /<meta http-equiv="refresh"/i, 'must not auto-redirect to Google');
    const lower = doc.toLowerCase();
    for (const bribe of ['discount', 'free', 'gift card', '% off', 'in exchange', 'reward']) {
      assert.ok(!lower.includes(bribe), 'a review must never be incentivised: ' + bribe);
    }
    // And no satisfaction gate: there is one link, not a happy/unhappy fork.
    assert.ok(!lower.includes('were you satisfied'), 'reviews must not be screened');
    assert.equal((doc.match(/Leave RYDJA a Google Review/g) || []).length, 1, 'one link, one path');
  } finally {
    withUrl.stop();
  }
});

test('with no review URL configured, nothing is rendered', async () => {
  const admin = cookie;
  const res = await app.post('/quote', submission({ phone: '6165550910', form_stamp: await freshStamp(app) }), { ip: '203.0.113.92' });
  assert.equal(res.status, 302);
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();

  await app.post('/admin/leads/' + lead.id + '/quote', { amount: '400', notes: '' },
    { headers: { cookie: admin }, ip: '203.0.113.99' });
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.93' });
  const job = app.read.prepare('select * from jobs where lead_id = ?').get(lead.id);
  await app.post('/admin/jobs/' + job.id + '/status', { status: 'complete' },
    { headers: { cookie: admin }, ip: '203.0.113.99' });

  const doc = await html('/q/' + lead.public_token);
  assert.doesNotMatch(doc, /How did we do\?/);
  assert.doesNotMatch(doc, /Google Review/);
});

// ---------------------------------------------------------------- privacy

test('private pages stay private, and no personal data reaches a public page', async () => {
  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();

  for (const [path, headers] of [['/q/' + lead.public_token, {}], ['/quote/sent', {}],
                                 ['/admin/leads', { cookie }], ['/admin/jobs', { cookie }]]) {
    assert.match(await html(path, headers), /<meta name="robots" content="noindex,nofollow">/, path);
  }

  for (const path of INDEXABLE) {
    const doc = await html(path);
    assert.ok(!doc.includes(lead.public_token), path + ' leaks a token');
    assert.ok(!doc.includes('Dana Reed'), path + ' leaks a customer name');
    // Strip form placeholders first: "123 Main St" in an address field is an
    // example of what to type, not an address we are publishing.
    const published = doc.replace(/placeholder="[^"]*"/g, '');
    assert.doesNotMatch(
      published,
      /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct)\b/,
      path + ' contains something shaped like a street address'
    );
  }
});

// ---------------------------------------------------------------- images

test('the images used are optimised and declare their size', async () => {
  for (const [path, limit] of [['/img/rydja-logo.jpg', 60], ['/img/rydja-logo.webp', 40],
                               ['/img/rydja-truck-trailer.webp', 200], ['/img/rydja-truck-trailer.jpg', 220]]) {
    const res = await app.get(path);
    assert.equal(res.status, 200, path);
    const kb = (await res.arrayBuffer()).byteLength / 1024;
    assert.ok(kb < limit, path + ' is ' + Math.round(kb) + 'KB, over the ' + limit + 'KB budget');
  }

  // Any <img> the site renders must carry dimensions and alt text, or it will
  // shift the layout as it loads.
  for (const path of INDEXABLE) {
    const doc = await html(path);
    for (const tag of doc.match(/<img[^>]*>/g) || []) {
      assert.match(tag, /\salt="/, path + ' has an image with no alt: ' + tag.slice(0, 60));
      assert.match(tag, /\swidth="\d+"/, path + ' has an image with no width: ' + tag.slice(0, 60));
      assert.match(tag, /\sheight="\d+"/, path + ' has an image with no height: ' + tag.slice(0, 60));
    }
  }
});

test('the owner appears once, named, with no biography and no address', async () => {
  const doc = await html('/');

  assert.match(doc, /Locally owned\. Personally handled\./);
  assert.match(doc, /Josh<\/strong> &mdash; Owner\/Operator/);
  assert.match(doc, /owner-operated/i);

  // One photograph, used once, sized, lazy, and described.
  const owner = doc.match(/<img[^>]*josh-owner-rydja[^>]*>/g) || [];
  assert.equal(owner.length, 1, 'the owner photo should appear exactly once');
  assert.match(owner[0], /alt="Josh, owner of RYDJA, beside a RYDJA work truck"/);
  assert.match(owner[0], /width="800"/);
  assert.match(owner[0], /height="600"/);
  assert.match(owner[0], /loading="lazy"/);
  assert.match(doc, /<source srcset="\/img\/josh-owner-rydja\.webp/, 'a modern format with a fallback');

  // It is a trust element, not a biography, and it carries nothing private.
  const section = doc.slice(doc.indexOf('id="owner"'), doc.indexOf('id="area"'));
  const words = section.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length;
  assert.ok(words < 90, 'the owner section is a trust element, not a life story (' + words + ' words)');

  // Whole words only: "son" lives inside "Personally handled", which is the
  // heading we actually want.
  const lower = section.toLowerCase();
  for (const overshare of ['wife', 'husband', 'kids', 'children', 'son', 'daughter', 'family',
                           'born in', 'grew up', 'lives at', 'home address']) {
    assert.doesNotMatch(
      lower,
      new RegExp('\\b' + overshare.replace(/ /g, '\\s+') + '\\b'),
      'the owner section must not include: ' + overshare
    );
  }
  assert.doesNotMatch(
    section.replace(/placeholder="[^"]*"/g, ''),
    /\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr)/,
    'no address beside the owner'
  );
});

test('only the approved images are served to the public', async () => {
  // The site serves derivatives, never the multi-megabyte originals, and only
  // the ones chosen for a page. Everything else stays local.
  const allowed = new Set([
    '/img/rydja-logo.jpg', '/img/rydja-logo.webp',
    '/img/rydja-truck-trailer.jpg', '/img/rydja-truck-trailer.webp',
    '/img/josh-owner-rydja.jpg', '/img/josh-owner-rydja.webp'
  ]);

  const seen = new Set();
  for (const path of INDEXABLE) {
    const doc = await html(path);
    for (const m of doc.matchAll(/(?:src|srcset)="(\/img\/[^"?]+)/g)) seen.add(m[1]);
  }
  for (const ref of seen) assert.ok(allowed.has(ref), 'unexpected image on a public page: ' + ref);

  // Nothing from the source folder is reachable over HTTP.
  for (const original of ['/images/RYDJA%20Hauling%20Logo.png', '/images/originals/RYDJA%20Hauling%20Logo.png',
                          '/img/originals/logo.png']) {
    assert.ok((await app.get(original)).status >= 400, original + ' must not be served');
  }

  // And nothing anywhere near the weight of a source file is served either.
  for (const ref of seen) {
    const res = await app.get(ref);
    assert.equal(res.status, 200, ref + ' is referenced but does not resolve');
    const bytes = (await res.arrayBuffer()).byteLength;
    assert.ok(bytes < 400 * 1024, ref + ' is ' + Math.round(bytes / 1024) + 'KB -- that is an original, not a derivative');
  }
});

// Each versioned asset must be versioned by its OWN bytes. The owner photo
// shared a hash with the truck photo once, so replacing the portrait left ?v=
// unchanged and browsers kept the old picture -- the exact failure the version
// exists to prevent.
test('every image carries a cache key derived from the file it points at', async () => {
  const version = (doc, file) => {
    const m = doc.match(new RegExp('/img/' + file + '\\?v=([a-f0-9]+)'));
    assert.ok(m, file + ' should be referenced with a ?v=');
    return m[1];
  };

  const home = await html('/');
  const area = await html('/service-area');

  const owner = version(home, 'josh-owner-rydja\\.webp');
  const truck = version(area, 'rydja-truck-trailer\\.webp');
  assert.notEqual(owner, truck, 'two different photographs must not share one cache key');

  // The webp and its jpeg fallback are the same picture, so they share a key.
  assert.equal(version(home, 'josh-owner-rydja\\.jpg'), owner);

  // And the key really is the hash of the bytes being served.
  const crypto = require('node:crypto');
  const served = Buffer.from(await (await app.get('/img/josh-owner-rydja.webp')).arrayBuffer());
  assert.equal(crypto.createHash('sha1').update(served).digest('hex').slice(0, 10), owner);
});

// ---------------------------------------------------------------- facebook

test('the Facebook page is linked publicly, safely, and with no tracking', async () => {
  const FB = 'https://www.facebook.com/profile.php?id=61595103063360';

  const home = await html('/');
  assert.ok(home.includes(FB), 'the homepage should link the Facebook page');
  assert.match(home, /Follow RYDJA on Facebook/, 'the footer needs a labelled link');
  assert.match(home, /RYDJA on Facebook<\/a>/, 'the owner section links it too');

  // Every link to it opens safely in a new tab.
  for (const tag of home.match(/<a[^>]*facebook\.com[^>]*>/g) || []) {
    assert.match(tag, /target="_blank"/, 'social link should open in a new tab: ' + tag);
    assert.match(tag, /rel="[^"]*noopener/, 'social link needs rel=noopener: ' + tag);
  }

  // Inherited by the shared footer on every public page.
  for (const path of INDEXABLE) {
    assert.ok((await html(path)).includes(FB), path + ' should carry the footer social link');
  }

  // The share URL carries a Facebook tracking parameter. It must not be the
  // one we publish, on a site whose privacy policy says it runs no tracking.
  for (const path of ['/', '/privacy']) {
    const doc = await html(path);
    assert.ok(!doc.includes('mibextid'), path + ' must not carry a Facebook tracking parameter');
    assert.ok(!doc.includes('facebook.net'), path + ' must not load the Facebook SDK');
    assert.ok(!doc.includes('connect.facebook'), path + ' must not load a Facebook pixel');
  }
});

test('sameAs lists the Facebook page and nothing invented', async () => {
  const doc = await html('/');
  const biz = JSON.parse(doc.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

  assert.ok(Array.isArray(biz.sameAs), 'sameAs should be an array');
  assert.deepEqual(biz.sameAs, ['https://www.facebook.com/profile.php?id=61595103063360']);

  // Only accounts that actually exist. No placeholder profiles.
  for (const guess of ['twitter.com', 'instagram.com', 'linkedin.com', 'youtube.com', 'yelp.com', 'tiktok.com']) {
    assert.ok(!JSON.stringify(biz.sameAs).includes(guess), 'sameAs must not invent a ' + guess + ' profile');
  }
});

test('the Facebook link can be reconfigured, and disappears when unset', async () => {
  const none = await startServer({ SITE_URL: SITE, FACEBOOK_URL: ' ' });
  try {
    const doc = await (await none.get('/')).text();
    assert.ok(!doc.includes('facebook.com'), 'no link when the URL is unset');
    const biz = JSON.parse(doc.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.ok(!('sameAs' in biz), 'no empty sameAs in the structured data');
  } finally {
    none.stop();
  }
});

// ---------------------------------------------------------------- canonical URLs

test('a trailing slash redirects rather than duplicating the page', async () => {
  for (const path of ['/junk-removal', '/cleanouts', '/service-area', '/privacy']) {
    const res = await app.get(path + '/');
    assert.equal(res.status, 301, path + '/ should redirect');
    assert.equal(res.headers.get('location'), path, path + '/ should land on ' + path);
  }
  // The root is not a trailing slash to strip.
  assert.equal((await app.get('/')).status, 200);
});

test('the sitemap carries no optional fields and nothing computed at request time', async () => {
  const first = await (await app.get('/sitemap.xml')).text();
  const second = await (await app.get('/sitemap.xml')).text();

  // Byte-identical between requests: a static file has no clock in it.
  assert.equal(first, second, 'two requests must return the same bytes');

  for (const optional of ['lastmod', 'changefreq', 'priority']) {
    assert.ok(!first.includes('<' + optional + '>'), 'stripped back to <loc> only: found ' + optional);
  }
  // <urlset> and <url> and <loc>, and no other element.
  const tags = [...new Set([...first.matchAll(/<(\w[\w:-]*)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(tags, ['loc', 'url', 'urlset']);
});

test('no promotional image is presented as a documented customer job', async () => {
  for (const path of INDEXABLE) {
    const doc = await html(path);
    const lower = doc.toLowerCase();

    // Unambiguous claims of documented work we do not have yet.
    for (const claim of ['case study', 'completed job for', 'actual job photo', 'real customer job']) {
      assert.ok(!lower.includes(claim), path + ' must not claim documented work: ' + claim);
    }

    // The narrower rule that actually matters: no image may caption itself as
    // a particular job. Saying elsewhere that we send customers before/after
    // photos of their own job is simply true, and stays allowed.
    for (const tag of doc.match(/<img[^>]*>/g) || []) {
      const alt = (tag.match(/alt="([^"]*)"/) || ['', ''])[1].toLowerCase();
      for (const claim of ['before', 'after', 'job we completed', 'customer', 'case study']) {
        assert.ok(!alt.includes(claim), path + ' image alt implies documented work: ' + alt);
      }
    }
    for (const cap of doc.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/g) || []) {
      const text = cap.replace(/<[^>]+>/g, '').toLowerCase();
      for (const claim of ['before', 'after', 'we completed', 'this job', 'customer']) {
        assert.ok(!text.includes(claim), path + ' caption implies documented work: ' + text.trim());
      }
    }
  }
});
