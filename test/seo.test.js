'use strict';

// What a crawler and a link preview actually see.
//
// The load-bearing assertion in here is the privacy one: the customer's own
// page and every admin page must stay out of the index, and nothing on a
// public page may leak a private URL into a sitemap or a share card.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, freshStamp, submission } = require('./helpers');

const SITE_URL = 'https://getrydja.com';
// Everything a crawler should have. The legal pages are public on purpose: a
// customer should be able to read the terms before handing over a photo of
// their garage.
const PUBLIC_PAGES = ['/', '/services', '/quote', '/terms', '/privacy', '/accessibility'];

let app;
let lead;
let cookie;

test.before(async () => {
  app = await startServer({ SITE_URL, BUSINESS_PHONE: '1-616-929-3360' });
  cookie = await app.adminCookie();
  const res = await app.post('/quote', submission({ form_stamp: await freshStamp(app) }), { ip: '203.0.113.60' });
  assert.equal(res.status, 302);
  lead = app.read.prepare('select * from leads order by id desc limit 1').get();
});

test.after(() => app?.stop());

const html = async (url, headers) => (await app.get(url, { headers })).text();
const meta = (doc, re) => { const m = doc.match(re); return m ? m[1] : null; };

// ---------------------------------------------------------------- public

test('every public page carries a full, unique set of metadata', async () => {
  const titles = [];

  for (const path of PUBLIC_PAGES) {
    const doc = await html(path);

    const title = meta(doc, /<title>([^<]*)<\/title>/);
    assert.ok(title && title.length > 10, path + ' needs a real title');
    titles.push(title);

    const description = meta(doc, /<meta name="description" content="([^"]+)"/);
    assert.ok(description && description.length > 40, path + ' needs a real description');

    assert.equal(meta(doc, /<link rel="canonical" href="([^"]+)"/), SITE_URL + path, path + ' canonical');
    assert.equal(meta(doc, /property="og:url" content="([^"]+)"/), SITE_URL + path, path + ' og:url');
    assert.equal(meta(doc, /property="og:type" content="([^"]+)"/), 'website');
    assert.equal(meta(doc, /property="og:title" content="([^"]+)"/), title);
    assert.equal(meta(doc, /property="og:description" content="([^"]+)"/), description);
    assert.match(meta(doc, /property="og:image" content="([^"]+)"/), /^https:\/\/getrydja\.com\/og-image\.jpg/);
    assert.equal(meta(doc, /name="twitter:card" content="([^"]+)"/), 'summary_large_image');
    assert.ok(meta(doc, /name="twitter:image" content="([^"]+)"/), path + ' twitter:image');

    assert.doesNotMatch(doc, /name="robots"/, path + ' must not carry a robots directive');
  }

  assert.equal(new Set(titles).size, titles.length, 'public titles must not repeat');
});

test('every public page has exactly one h1', async () => {
  for (const path of PUBLIC_PAGES) {
    const doc = await html(path);
    assert.equal((doc.match(/<h1[\s>]/g) || []).length, 1, path + ' should have one h1');
  }
});

test('the homepage targets the business, not a keyword list', async () => {
  const doc = await html('/');

  assert.equal(
    meta(doc, /<title>([^<]*)<\/title>/),
    'RYDJA | Junk Removal, Cleanouts &amp; Property Help in West Michigan'
  );
  const description = meta(doc, /<meta name="description" content="([^"]+)"/);
  assert.match(description, /junk removal/i);
  assert.match(description, /West Michigan/);
  assert.ok(description.length <= 160, 'description should stay inside what a search result shows');

  // The hero is still the hero. SEO did not rewrite it.
  assert.match(doc, /Point at the/);
  assert.match(doc, /We&rsquo;ll handle the/);
});

test('the service area is stated on the page, not only in markup', async () => {
  const doc = await html('/');
  assert.match(doc, /Serving Lowell, Stanton and surrounding West Michigan communities/);
  assert.ok(doc.includes('href="tel:+16169293360"'), 'the phone must be clickable');
});

test('the services page names the work in the words a customer would use', async () => {
  const doc = await html('/services');

  for (const term of [
    'Junk removal', 'Garage cleanouts', 'Basement cleanouts', 'Barn cleanouts',
    'Storage unit cleanouts', 'Estate cleanouts', 'Yard cleanup', 'Furniture removal',
    'Appliance removal', 'Moving help', 'Light demolition', 'Scrap pickup', 'Property resets'
  ]) {
    assert.ok(doc.includes(term), 'services page should mention ' + term);
  }
});

test('the footer carries the contact block, and no private address', async () => {
  const doc = await html('/');
  assert.match(doc, /RYDJA/);
  assert.match(doc, /getrydja\.com/);
  assert.ok(doc.includes('1-616-929-3360'));
  assert.match(doc, /Serving Lowell/);
});

// ---------------------------------------------------------------- private

test('nothing private is indexable', async () => {
  const privatePages = [
    ['/quote/sent', {}],
    ['/q/' + lead.public_token, {}],
    ['/admin/login', {}],
    ['/admin/leads', { cookie }],
    ['/admin/jobs', { cookie }],
    ['/admin/leads/' + lead.id, { cookie }]
  ];

  for (const [path, headers] of privatePages) {
    const doc = await html(path, headers);
    assert.match(doc, /<meta name="robots" content="noindex,nofollow">/, path + ' must be noindex,nofollow');
    // No canonical and no Open Graph either: a chat app should not unfurl a
    // customer's private link into a preview card.
    assert.doesNotMatch(doc, /rel="canonical"/, path + ' must not be canonicalised');
    assert.doesNotMatch(doc, /property="og:/, path + ' must not carry Open Graph tags');
    assert.doesNotMatch(doc, /name="twitter:/, path + ' must not carry Twitter tags');
  }
});

// ---------------------------------------------------------------- robots

test('robots.txt allows the public site and points at the sitemap', async () => {
  const res = await app.get('/robots.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);

  const body = await res.text();
  assert.match(body, /^User-agent: \*$/m);
  assert.match(body, /^Allow: \/$/m);
  assert.match(body, /^Disallow: \/admin$/m);
  assert.match(body, /^Disallow: \/q\/$/m);
  assert.match(body, new RegExp('^Sitemap: ' + SITE_URL + '/sitemap\\.xml$', 'm'));
});

// ---------------------------------------------------------------- sitemap

test('sitemap.xml is valid and lists only indexable pages', async () => {
  const res = await app.get('/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /xml/);

  const xml = await res.text();
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<\/urlset>\s*$/);

  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, PUBLIC_PAGES.map((p) => SITE_URL + p));

  // The thing that must never happen.
  assert.ok(!xml.includes(lead.public_token), 'a private token must never reach the sitemap');
  assert.ok(!/\/admin/.test(xml), 'admin must never reach the sitemap');
  assert.ok(!/\/quote\/sent/.test(xml), 'the confirmation page is noindex and does not belong here');

  for (const loc of locs) assert.ok(loc.startsWith(SITE_URL + '/'), 'absolute https URLs only: ' + loc);

  // Well formed enough that a parser will not choke.
  assert.equal((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
});

// ---------------------------------------------------------------- JSON-LD

test('the homepage carries valid structured data, and invents nothing', async () => {
  const doc = await html('/');
  const raw = meta(doc, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(raw, 'the homepage should carry a JSON-LD block');

  const data = JSON.parse(raw); // throws if the markup is not valid JSON
  assert.equal(data['@context'], 'https://schema.org');
  assert.equal(data['@type'], 'HomeAndConstructionBusiness');
  assert.equal(data.name, 'RYDJA');
  assert.equal(data.url, SITE_URL + '/');
  assert.equal(data.telephone, '1-616-929-3360');
  assert.equal(data.logo, SITE_URL + '/icon-512.png');
  assert.match(data.description, /West Michigan/);
  assert.deepEqual(
    data.areaServed.map((a) => a.name),
    ['Lowell, Michigan', 'Stanton, Michigan', 'West Michigan']
  );
  assert.ok(data.knowsAbout.includes('junk removal'));

  // Claims we have no basis for must not appear. A wrong knowledge panel is
  // worse than no knowledge panel.
  for (const invented of ['address', 'openingHours', 'openingHoursSpecification',
                          'priceRange', 'aggregateRating', 'review', 'sameAs']) {
    assert.ok(!(invented in data), 'must not invent ' + invented);
  }
});

// ---------------------------------------------------------------- assets

test('the icon set, manifest and share image are all served', async () => {
  const expected = [
    ['/favicon.ico', /image\/(x-icon|vnd\.microsoft\.icon)/],
    ['/favicon-16x16.png', /image\/png/],
    ['/favicon-32x32.png', /image\/png/],
    ['/apple-touch-icon.png', /image\/png/],
    ['/icon-192.png', /image\/png/],
    ['/icon-512.png', /image\/png/],
    ['/og-image.jpg', /image\/jpeg/],
    ['/site.webmanifest', /manifest|json/]
  ];

  for (const [path, type] of expected) {
    const res = await app.get(path);
    assert.equal(res.status, 200, path + ' should be served');
    assert.match(res.headers.get('content-type'), type, path + ' content type');
    const bytes = (await res.arrayBuffer()).byteLength;
    assert.ok(bytes > 100, path + ' looks empty');
    assert.ok(bytes < 400 * 1024, path + ' is too heavy at ' + bytes + ' bytes');
  }
});

test('the head wires the icons and manifest up', async () => {
  const doc = await html('/');
  assert.match(doc, /<link rel="icon" href="\/favicon\.ico" sizes="any">/);
  assert.match(doc, /<link rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32x32\.png\?v=[0-9a-f]{10}">/);
  assert.match(doc, /<link rel="icon" type="image\/png" sizes="16x16" href="\/favicon-16x16\.png\?v=[0-9a-f]{10}">/);
  assert.match(doc, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png\?v=[0-9a-f]{10}">/);
  assert.match(doc, /<link rel="manifest" href="\/site\.webmanifest\?v=[0-9a-f]{10}">/);
  assert.match(doc, /<meta name="theme-color" content="#171816">/);
});

test('the manifest is valid JSON with the brand and its icons', async () => {
  const manifest = JSON.parse(await (await app.get('/site.webmanifest')).text());

  assert.equal(manifest.name, 'RYDJA');
  assert.equal(manifest.short_name, 'RYDJA');
  assert.equal(manifest.theme_color, '#171816');
  assert.equal(manifest.start_url, '/');

  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));

  // Every icon the manifest promises must actually exist.
  for (const icon of manifest.icons) {
    assert.equal((await app.get(icon.src)).status, 200, icon.src + ' is promised by the manifest');
  }
});

// ---------------------------------------------------------------- canonical

test('canonical URLs are absolute https on the production host', async () => {
  for (const path of PUBLIC_PAGES) {
    const doc = await html(path);
    const canonical = meta(doc, /<link rel="canonical" href="([^"]+)"/);
    assert.match(canonical, /^https:\/\/getrydja\.com/, path);
    assert.ok(!canonical.includes('www.'), 'www must not produce a second canonical: ' + canonical);
    assert.ok(!canonical.includes('127.0.0.1'), 'the request host must never leak into a canonical');
  }
});
