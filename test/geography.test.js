'use strict';

// The geographic claim, and the two things about it that must never regress.
//
// ------------------------------------------------------------ what this is for
//
// Twenty-eight days of Search Console showed the site being offered to
// Portage, Novi, West Branch, West Bloomfield and -- for a brush job --
// Mancelona, 150 miles north. None of that was Google being stupid: the site
// said "West Michigan" on all nineteen pages and in all eight service page
// titles, West Michigan holds about two million people, and Portage is in it.
//
// The claim is now the territory: a business based around Lowell in Kent
// County, working outward through Ada, Rockford, Greenville and Ionia, and
// reaching Stanton and Baldwin for work that justifies the drive.
//
// Two things are load-bearing here and both are explicit instructions rather
// than preferences:
//
//   PRESERVATION  Stanton and Baldwin coverage must survive every change --
//                 the landing page, the content, the structured data, the
//                 sitemap entry, the internal links and the service coverage.
//                 Not one of those may be quietly dropped while re-pointing
//                 the marketing at Lowell.
//
//   PRIVACY       RYDJA is a service-area business. The owner's operating
//                 address is residential and must appear nowhere: not in copy,
//                 not in structured data, not in a source comment, not in the
//                 repository at all.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');

const area = require('../content/service-area');
const { LOCAL_PAGES } = require('../content/local-pages');
const { SERVICE_PAGES } = require('../content/service-pages');

const SITE = 'https://getrydja.com';
const ROOT = path.join(__dirname, '..');

let app;

test.before(async () => {
  app = await startServer({ SITE_URL: SITE, BUSINESS_PHONE: '1-616-929-3360' });
});

test.after(() => app?.stop());

const html = async (url) => (await app.get(url)).text();

/** Visible page text, with the title and meta description folded in. */
function pageText(doc) {
  const title = (doc.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const desc = (doc.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  const body = doc
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return [title, desc, body].join(' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
}

const PUBLIC_PATHS = [
  '/', '/services', '/quote', '/service-area', '/property-professionals',
  ...SERVICE_PAGES.map((p) => '/' + p.slug),
  ...LOCAL_PAGES.map((p) => '/' + p.slug),
  '/terms', '/privacy', '/accessibility', '/image-credits'
];

// ------------------------------------------------- the record

test('the service area is one record, eighteen places, four counties', () => {
  assert.equal(area.PLACES.length, 18, 'the eighteen the owner set on the Business Profile');
  assert.deepEqual(area.COUNTIES, ['Kent', 'Montcalm', 'Ionia', 'Lake']);

  // Every place carries the county it is actually in, because the county list
  // is derived from this and a wrong county publishes a wrong boundary.
  for (const p of area.PLACES) {
    assert.ok(p.name, 'every place is named');
    assert.ok(area.COUNTIES.includes(p.county), p.name + ' needs a real county');
    assert.ok([area.CORE, area.NEARBY, area.EXTENDED].includes(p.tier), p.name + ' needs a tier');
  }

  // No duplicates, which is how a coverage list grows a second entry for the
  // same town under a slightly different name.
  const names = area.PLACES.map((p) => p.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'no place may be listed twice');
});

test('a tier is a marketing priority and the page says so', async () => {
  const doc = await html('/service-area');
  const text = pageText(doc);

  for (const tier of area.TIERS) assert.ok(text.includes(tier.label), 'the page needs the tier: ' + tier.label);

  // The sentence that stops somebody outside the core assuming we refuse. This
  // is the whole reason the tiers are safe to publish.
  assert.match(text, /These are priorities, not limits/i);
  assert.match(text, /not a boundary/i);
  assert.match(text, /no job is refused for being in the wrong group/i);
  assert.match(text, /worth a longer drive/i, 'the estate-travel exception must be stated');

  // No invented radius. The honest answer is load size, not mileage.
  assert.ok(!/\b\d+\s*(mile|mi)\b/i.test(text), 'no radius may be invented');
});

test('every one of the eighteen places is on the service-area page', async () => {
  const text = pageText(await html('/service-area'));
  for (const place of area.PLACES) {
    assert.ok(text.includes(place.name), 'the service-area page should name ' + place.name);
  }
});

// ------------------------------------------------- PRESERVATION

test('Stanton coverage survives in full', async () => {
  // 1. The landing page still answers, with its own title, h1 and content.
  const res = await app.get('/junk-removal-stanton-mi');
  assert.equal(res.status, 200, 'the Stanton landing page must not be removed or redirected');
  const doc = await res.text();
  assert.equal((doc.match(/<h1/g) || []).length, 1);
  assert.match(doc, /Stanton/);
  assert.ok(pageText(doc).split(' ').length > 900, 'the Stanton page must not be thinned');

  // 2. Its structured data is intact, and still a Service for that one city.
  const blocks = [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]));
  assert.deepEqual(blocks.map((b) => b['@type']), ['Service', 'BreadcrumbList', 'FAQPage']);
  assert.equal(blocks[0].areaServed.name, 'Stanton');
  assert.match(blocks[0].areaServed.containedInPlace.name, /Montcalm/);

  // 3. Its canonical is unchanged -- the URL carries whatever equity it has.
  assert.match(doc, new RegExp('<link rel="canonical" href="' + SITE + '/junk-removal-stanton-mi">'));

  // 4. It is still in the sitemap.
  const sitemap = await html('/sitemap.xml');
  assert.ok(sitemap.includes(SITE + '/junk-removal-stanton-mi'), 'Stanton must stay in the sitemap');

  // 5. It is still linked internally, and now from the body rather than only
  //    the footer.
  const areaPage = await html('/service-area');
  assert.ok(areaPage.includes('href="/junk-removal-stanton-mi"'), '/service-area must link it');
  const home = await html('/');
  assert.ok(home.includes('href="/junk-removal-stanton-mi"'), 'the footer must still link it');

  // 6. Stanton is still served, in the configuration and in the markup.
  assert.ok(area.PROTECTED.includes('Stanton'));
  const business = JSON.parse((home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1]);
  assert.ok(business.areaServed.some((a) => a.name === 'Stanton, Michigan'), 'areaServed must keep Stanton');
  assert.match(business.description, /Stanton/, 'the business description must still name Stanton');
});

test('Baldwin coverage survives', async () => {
  const home = await html('/');
  const business = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

  assert.ok(area.PROTECTED.includes('Baldwin'));
  assert.ok(business.areaServed.some((a) => a.name === 'Baldwin, Michigan'), 'areaServed must keep Baldwin');
  assert.ok(business.areaServed.some((a) => a.name === 'Lake County, Michigan'),
    'and the county it sits in, which is no other place on the list');

  const text = pageText(await html('/service-area'));
  assert.ok(text.includes('Baldwin'), 'the service-area page must still name Baldwin');
});

test('a configuration override cannot drop protected coverage', async () => {
  // The brief asks for two things that pull against each other: an override
  // must not be able to lose Stanton or Baldwin, and the app must not fail
  // when the area is legitimately reconfigured. So a protected place is
  // RESTORED with a warning rather than refused.
  const warnings = [];
  const resolved = area.resolvePlaces(['Testville, Michigan'], (m) => warnings.push(m));

  assert.ok(resolved.includes('Stanton, Michigan'), 'Stanton restored');
  assert.ok(resolved.includes('Baldwin, Michigan'), 'Baldwin restored');
  assert.equal(warnings.length, 2, 'and said so, loudly, for both');
  for (const w of warnings) assert.match(w, /protected coverage/);

  // And the app boots with a narrowed area rather than refusing to start.
  const narrowed = await startServer({
    SITE_URL: SITE,
    SERVICE_AREA: 'Testville and the surrounding Test County area',
    SERVICE_AREA_PLACES: 'Testville, Michigan|Test County'
  });
  try {
    const doc = await (await narrowed.get('/service-area')).text();
    const text = pageText(doc);
    assert.match(text, /Testville/, 'the override is reflected on the page');
    assert.ok(text.includes('Stanton'), 'and protected coverage is still there');
    assert.ok(text.includes('Baldwin'));
    // The default must no longer be baked in: a narrowed deployment must not
    // go on claiming the towns it dropped.
    assert.ok(!text.includes('Rockford'), 'a dropped town must leave the page');
    assert.ok(!text.includes('Greenville'), 'and so must another');
  } finally {
    narrowed.stop();
  }
});

// ------------------------------------------------- the retarget itself

test('the region is no longer the primary claim anywhere', async () => {
  let regionPages = 0;

  for (const p of PUBLIC_PATHS) {
    const doc = await html(p);
    const title = (doc.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const desc = (doc.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
    const h1 = (doc.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';

    // The three places a geographic claim actually carries weight.
    assert.ok(!/West Michigan/i.test(title), p + ' title must not claim the region');
    assert.ok(!/West Michigan/i.test(desc), p + ' description must not claim the region');
    assert.ok(!/West Michigan/i.test(h1), p + ' h1 must not claim the region');

    if (/West Michigan/i.test(pageText(doc))) regionPages++;
  }

  // Still allowed in prose, because it is true and people say it. What is not
  // allowed is it being the claim on nineteen pages, which is what it was.
  assert.ok(regionPages <= 4, 'the region appears in prose on ' + regionPages + ' pages; it was all 19');
});

test('every service page names the area in its h1', async () => {
  // Seven of the eight named no place at all, which was the largest on-page
  // relevance gap the audit found.
  for (const page of SERVICE_PAGES) {
    const doc = await html('/' + page.slug);
    const h1 = (doc.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1].replace(/<[^>]+>/g, '');
    assert.match(h1, /Lowell/, '/' + page.slug + ' h1 should name the area');
  }
});

test('the core markets reach every public page', async () => {
  // They used to reach three. The coverage sentence is in the footer, so
  // naming them there puts them on every page in one factual statement rather
  // than stuffing them into nineteen titles.
  for (const p of PUBLIC_PATHS) {
    const text = pageText(await html(p));
    for (const town of area.LEAD_PLACES) {
      assert.ok(text.includes(town), p + ' should name ' + town);
    }
    assert.ok(text.includes('Stanton'), p + ' should still name Stanton');
  }
});

test('the city pages are linked from the body, not only the footer', async () => {
  // A footer link is discounted, and nobody scanning a page for their own town
  // reads down there. Each service page now carries a contextual link.
  for (const page of SERVICE_PAGES) {
    const doc = await html('/' + page.slug);
    const beforeFooter = doc.slice(0, doc.indexOf('<footer'));
    for (const local of LOCAL_PAGES) {
      assert.ok(
        beforeFooter.includes('href="/' + local.slug + '"'),
        '/' + page.slug + ' should link /' + local.slug + ' above the footer'
      );
    }
  }
});

// ------------------------------------------------- PRIVACY

test('no operating address is exposed anywhere a visitor or crawler can reach', async () => {
  const STREET = /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Way|Trail|Hwy)\b/;

  for (const p of [...PUBLIC_PATHS, '/sitemap.xml', '/robots.txt', '/site.webmanifest']) {
    const doc = await html(p);
    // Placeholders are input hints, not page content: the optional address
    // field on the quote form says "123 Main St" to show a customer what to
    // type there, which is the opposite of exposing an address of ours.
    const content = doc.replace(/placeholder="[^"]*"/g, '');
    assert.ok(!STREET.test(content), p + ' must not expose a street address');
    // The specific address that was once on a social profile, in every
    // spelling somebody might paste it in.
    for (const fragment of ['Fero Ave', 'Fero Avenue', '1251 Fero']) {
      assert.ok(!doc.includes(fragment), p + ' must never contain ' + fragment);
    }
  }

  // And the structured data, which is where an address is most tempting to add
  // because a schema validator asks for one.
  const business = JSON.parse((await html('/')).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  for (const field of ['address', 'location', 'hasMap', 'geo', 'streetAddress']) {
    assert.ok(!(field in business), 'structured data must not carry ' + field);
  }
});

test('no operating address is in the repository either', () => {
  // Source comments and documentation count: a commit is public the moment the
  // repository is, and a residential address in a code comment is the same
  // exposure as one on a page.
  const FILES = [
    'server.js', 'db.js', 'mail.js', 'attribution.js', 'analytics.js',
    'partners.js', 'opportunities.js', 'indexnow.js',
    'content/service-area.js', 'content/service-pages.js', 'content/local-pages.js',
    'content/homepage.js', 'content/service-catalog.js',
    'DEPLOY.md', 'README.md', 'organic-growth.md'
  ];

  for (const rel of FILES) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const fragment of ['Fero Ave', 'Fero Avenue', '1251 Fero']) {
      assert.ok(!text.includes(fragment), rel + ' must never contain ' + fragment);
    }
  }
});

// ------------------------------------------------- pending Google review

test('places awaiting Google review are tracked as pending, not claimed as live', () => {
  const pending = area.pending();
  assert.equal(pending.length, 9, 'nine areas were submitted on 2026-10-20 and are under review');

  // The nine that were already live on the profile must NOT be flagged pending.
  for (const live of ['Lowell', 'Ada Township', 'Rockford', 'Ionia', 'Alto',
                      'Belding', 'Grand Rapids', 'Stanton', 'Baldwin']) {
    assert.ok(!pending.includes(live), live + ' was already live and must not be marked pending');
  }

  // The site may describe a pending place, because RYDJA genuinely serves it.
  // What nothing may say is that Google has approved it.
  const source = fs.readFileSync(path.join(ROOT, 'content/service-area.js'), 'utf8');
  assert.match(source, /PENDING GOOGLE REVIEW/);
  assert.ok(
    !/all (nine|18|eighteen) (areas )?approved/i.test(source),
    'nothing may claim the pending edits are approved'
  );
});
