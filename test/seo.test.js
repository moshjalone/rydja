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
const { SERVICE_PAGES } = require('../content/service-pages');

// The indexable set, in sitemap order. Derived from the service page content so
// adding a page cannot leave this behind.
const PUBLIC_PAGES = [
  '/', '/quote', '/services',
  ...SERVICE_PAGES.map((p) => '/' + p.slug),
  '/service-area', '/terms', '/privacy', '/accessibility'
];

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
  assert.match(body, new RegExp('^Sitemap: ' + SITE_URL + '/sitemap\\.xml$', 'm'));

  // Deliberately no Disallow lines. robots.txt is a crawl hint that anyone can
  // read, so listing /admin there advertises it; noindex on the page itself is
  // what actually keeps private pages out of an index, and that is tested
  // separately in 'nothing private is indexable'.
  assert.doesNotMatch(body, /^Disallow:/m, 'privacy is noindex, not a published blocklist');
  assert.doesNotMatch(body, /^Noindex:/mi, 'not a directive Google supports');
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
  assert.ok(!/\/q\//.test(xml), 'a customer page must never reach the sitemap');
  assert.ok(!/\/quote\/sent/.test(xml), 'the confirmation page is noindex and does not belong here');
  assert.ok(!/token|uploads/i.test(xml), 'no token or upload URLs');

  for (const loc of locs) assert.ok(loc.startsWith(SITE_URL + '/'), 'absolute https URLs only: ' + loc);

  // Well formed enough that a parser will not choke.
  assert.equal((xml.match(/<url>/g) || []).length, (xml.match(/<\/url>/g) || []).length);
});

// Search Console rejected a generated sitemap that measured correct from the
// outside, so the sitemap is now a literal file with nothing optional in it.
// What is left to get wrong is the bytes, which is what this checks: Google
// parses the response, not the pretty version a browser renders.
test('sitemap.xml is a static file, well formed on the wire', async () => {
  const res = await app.get('/sitemap.xml');
  const bytes = Buffer.from(await res.arrayBuffer());

  assert.equal(res.headers.get('content-type'), 'application/xml; charset=utf-8');
  assert.ok(bytes.length > 0, 'an empty body reads as unparseable');
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a BOM breaks the parse');
  assert.equal(bytes[0], 0x3c, 'nothing may precede the XML declaration -- not even whitespace');
  assert.ok(!bytes.includes(0x0d), 'LF only: a stray CR in a declaration is a parse error');

  const xml = bytes.toString('utf8');
  assert.ok(
    xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns='),
    'the declaration and root element must open the document'
  );
  assert.doesNotMatch(xml, /<(?:!doctype|html|head|body|script|div)\b/i, 'an HTML page is not a sitemap');

  // Every ampersand has to be a real entity, or the document is not XML.
  assert.doesNotMatch(xml, /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/, 'unescaped ampersand');
  assert.doesNotMatch(xml, /&(?:nbsp|rsquo|mdash|ndash|hellip);/, 'HTML entities are undefined in XML');

  // Stripped back to the required element and nothing else.
  const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  assert.equal(blocks.length, PUBLIC_PAGES.length);
  for (const block of blocks) {
    const tags = [...block.matchAll(/<(\w+)>/g)].map((m) => m[1]);
    assert.deepEqual(tags, ['loc'], 'a <url> holds one <loc> and nothing else: ' + tags.join(', '));
  }

  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(new Set(locs).size, locs.length, 'a duplicate loc wastes crawl budget');
  for (const loc of locs) {
    assert.ok(!/[?#]/.test(loc), 'no query strings or fragments in a sitemap: ' + loc);
    assert.equal(loc.trim(), loc, 'whitespace around a loc: ' + JSON.stringify(loc));
  }

  // Not cached hard. A sitemap stuck in an edge cache is a mistake you cannot
  // retract, which matters precisely when you need to correct one.
  const cache = res.headers.get('cache-control') || '';
  assert.doesNotMatch(cache, /immutable|max-age=[1-9]/, 'must stay revalidatable: ' + cache);
});

test('every URL in the sitemap answers 200, and no route shadows the file', async () => {
  const xml = await (await app.get('/sitemap.xml')).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length > 0);

  for (const loc of locs) {
    const path = loc.slice(SITE_URL.length);
    const res = await app.get(path, { redirect: 'manual' });
    assert.equal(res.status, 200, loc + ' is in the sitemap but answers ' + res.status);
    assert.doesNotMatch(await res.text(), /name="robots"/, loc + ' is in the sitemap but noindex');
  }

  // One path, one response. The file is served by express.static; if a route
  // were ever reintroduced it would shadow it and we would be back to a
  // generated sitemap without noticing.
  const app2 = await startServer({ SITE_URL, SITE_URL_UNUSED: '1' });
  try {
    assert.equal(await (await app2.get('/sitemap.xml')).text(), xml, 'the response must not vary by config');
  } finally {
    app2.stop();
  }
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
  assert.equal(data.logo, SITE_URL + '/img/rydja-logo.jpg');
  assert.match(data.description, /West Michigan/);
  assert.deepEqual(
    data.areaServed.map((a) => a.name),
    ['Lowell, Michigan', 'Stanton, Michigan', 'West Michigan']
  );
  assert.ok(data.knowsAbout.includes('junk removal'));

  // Claims we have no basis for must not appear. A wrong knowledge panel is
  // worse than no knowledge panel.
  for (const invented of ['address', 'openingHours', 'openingHoursSpecification',
                          'priceRange', 'aggregateRating', 'review']) {
    assert.ok(!(invented in data), 'must not invent ' + invented);
  }

  // sameAs is allowed, but only for profiles that actually exist. Every entry
  // must be a real account we hold.
  for (const profile of data.sameAs || []) {
    assert.match(profile, /^https:\/\/www\.(facebook|instagram)\.com\//,
      'unexpected social profile: ' + profile);
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
