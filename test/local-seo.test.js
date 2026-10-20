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
const { LOCAL_PAGES } = require('../content/local-pages');

const SITE = 'https://getrydja.com';
const SERVICE_PATHS = SERVICE_PAGES.map((p) => '/' + p.slug);
// The B2B referral page. Indexable and internally linked, but deliberately not
// a SERVICE_PAGE: it offers no distinct job, so it carries no Service schema
// and is not an Offer in the catalog.
const PROFESSIONALS = '/property-professionals';
const LOCAL_PATHS = LOCAL_PAGES.map((p) => '/' + p.slug);
const INDEXABLE = ['/', '/services', '/quote', ...SERVICE_PATHS, PROFESSIONALS, '/service-area',
                   ...LOCAL_PATHS,
                   '/privacy', '/terms', '/accessibility', '/image-credits'];

let app;
let cookie;

test.before(async () => {
  app = await startServer({
    SITE_URL: SITE,
    BUSINESS_PHONE: '1-616-929-3360',
    // The social URLs as production sets them, share-sheet parameter included.
    FACEBOOK_URL: 'https://www.facebook.com/share/1BXxZTv6Qc/?mibextid=wwXIfr',
    INSTAGRAM_URL: 'https://www.instagram.com/rydjaservices/'
  });
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
    '/junk-removal', '/light-demolition', '/rental-property-cleanouts', '/yard-cleanup'
  ]);
});

// The defect this whole pass started from. /services used to be driven by a
// second, independent SERVICES array in server.js that had drifted from the
// real pages: different wording, almost no links to the pages that existed,
// and furniture and appliance removal missing altogether.
//
// These three tests are the ones that would fail again if anybody
// reintroduced a parallel list, so they assert the mechanism rather than the
// symptom: one catalog, every card a real page, every CTA a real form value.
test('there is one service catalog, and every page in it can be listed', () => {
  for (const page of SERVICE_PAGES) {
    assert.ok(page.card && page.card.title, '/' + page.slug + ' needs card.title to appear in a list');
    assert.ok(page.card.blurb && page.card.blurb.length > 40, '/' + page.slug + ' needs real card copy');
    assert.ok(page.quoteService, '/' + page.slug + ' must name the quote option its CTA prefills');
  }

  // No second marketing list anywhere. `services` used to be a template local
  // fed by that array; nothing may put one back.
  const server = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /^const SERVICES\s*=/m, 'a second marketing service list has come back');
  assert.doesNotMatch(server, /res\.locals\.services\s*=/, 'nothing should hand templates a parallel service list');
});

test('every service card on a listing page links its own page and a valid quote', async () => {
  const { QUOTE_SERVICES } = await quoteOptions();

  for (const listing of ['/', '/services']) {
    const doc = await html(listing);
    for (const page of SERVICE_PAGES) {
      assert.ok(doc.includes('href="/' + page.slug + '"'), listing + ' should link /' + page.slug);
      assert.ok(
        doc.includes('/quote?service=' + encodeURIComponent(page.quoteService)),
        listing + ' should prefill ' + page.quoteService + ' for /' + page.slug
      );
    }
  }

  // Every prefill the site offers has to be an option the form actually
  // carries, or the lead is stored under a label nothing else recognises.
  for (const page of SERVICE_PAGES) {
    assert.ok(QUOTE_SERVICES.includes(page.quoteService),
      '/' + page.slug + ' prefills "' + page.quoteService + '", which the form does not offer');
  }
});

// The options the live form renders, read off the form rather than imported,
// so this measures what a customer's browser would actually post.
async function quoteOptions() {
  const doc = await html('/quote');
  const select = doc.slice(doc.indexOf('name="service"'), doc.indexOf('</select>'));
  const QUOTE_SERVICES = [...select.matchAll(/<option(?:[^>]*)>([^<]+)</g)]
    .map((m) => m[1].trim())
    .filter((o) => o !== 'Choose a service');
  return { QUOTE_SERVICES };
}

test('a service page CTA adds no option of its own to the form', async () => {
  // The old failure mode: a page prefilled its nav label, the form did not
  // offer it, and the template quietly appended an extra <option selected>
  // carrying a value no filter, report or badge in the admin matches.
  const { QUOTE_SERVICES: plain } = await quoteOptions();

  for (const page of SERVICE_PAGES) {
    const doc = await html('/quote?service=' + encodeURIComponent(page.quoteService));
    const select = doc.slice(doc.indexOf('name="service"'), doc.indexOf('</select>'));
    const options = [...select.matchAll(/<option(?:[^>]*)>([^<]+)</g)]
      .map((m) => m[1].trim())
      .filter((o) => o !== 'Choose a service');

    assert.deepEqual(options, plain, '/' + page.slug + ' prefill changed the option list');
    assert.match(select, new RegExp('<option selected>' + page.quoteService.replace(/\//g, '\\/')),
      '/' + page.slug + ' should select its own option');
  }
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
  assert.match(doc, /href="\/services"/, 'homepage should link the services hub');
  assert.match(doc, new RegExp('href="' + PROFESSIONALS + '"'), 'homepage should link the referral page');
});

// Sections A and B: the two questions a visitor actually arrives with, which
// the service grid above them answers neither of. A card headed "Cleanouts"
// does not tell somebody holding a broken treadmill they are in the right
// place.
test('the homepage answers "do you take my thing" and "is my situation yours"', async () => {
  const doc = await html('/');
  const text = bodyText(doc).toLowerCase();

  assert.match(doc, /What can RYDJA haul away\?/);
  for (const item of ['couches and sectionals', 'mattresses', 'fridges and freezers', 'garage clutter',
                      'basement contents', 'storage-unit contents', 'scrap metal', 'exercise equipment',
                      'yard debris', 'brush and branches', 'storm debris', 'renovation debris',
                      'shelving', 'playsets', 'outdoor and patio furniture']) {
    assert.ok(text.includes(item), 'the haul-away section should name ' + item);
  }

  assert.match(doc, /When people call RYDJA/);
  for (const situation of ['moving out', 'settling an estate', 'inherited a property', 'ready to photograph and sell',
                           'rental to turn over', 'left furniture and belongings behind', 'the garage has not fitted',
                           'the basement is full', 'storage unit to empty', 'downsizing', 'storm took down limbs',
                           'shed or playset']) {
    assert.ok(text.includes(situation), 'the situations section should cover ' + situation);
  }

  // Both sections exist to route people, so every entry has to be a link to a
  // page that answers it -- and no entry may have grown a page of its own.
  const { HAUL_AWAY_GROUPS, CALL_SITUATIONS } = require('../content/homepage');
  for (const href of [...HAUL_AWAY_GROUPS.map((g) => g.href), ...CALL_SITUATIONS.map((s) => s.href)]) {
    assert.ok(doc.includes('href="' + href + '"'), 'the homepage promises ' + href);
    assert.equal((await app.get(href)).status, 200, href + ' is linked from the homepage but does not answer 200');
  }

  // Hazard exclusions are repeated here rather than only on the service pages,
  // because this is now the list somebody reads before deciding to ask.
  assert.match(text, /hazardous waste/i);
  assert.match(text, /asbestos/i);
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

test('the service area names the verified communities and explains the boundary', async () => {
  const doc = await html('/service-area');
  const text = bodyText(doc);

  // Every community from the canonical business record is named on the page,
  // from configuration rather than from a second list in the template.
  for (const place of ['Lowell', 'Stanton', 'Belding', 'Ionia', 'Grand Rapids', 'Rockford',
                       'Ada Township', 'Alto', 'Baldwin']) {
    assert.ok(text.includes(place), 'the area page should name ' + place);
  }

  // The statewide claim that is on the Business Profile and is deliberately
  // not propagated: one truck does not serve a state.
  assert.ok(!/Michigan,?\s*USA/i.test(text), 'a statewide service claim must not appear');
  assert.ok(!/\b\d+\s*(mile|mi)\b/i.test(text), 'no invented radius');

  // Why travel depends on the job, which is the honest version of a boundary.
  assert.match(text, /larger jobs/i);
  assert.match(text, /smaller jobs/i);
  assert.match(text, /Just outside/i);

  // Linked onward to every real service page and to the referral page.
  for (const page of SERVICE_PAGES) {
    assert.ok(doc.includes('href="/' + page.slug + '"'), '/service-area should link /' + page.slug);
  }
});

// This test used to assert that there were no city pages at all. Two now
// exist, for Lowell and Stanton, and the reasoning plus the rule a third would
// have to satisfy is at the top of content/local-pages.js. The guard did not
// go away -- it changed from "none" to "these two and nothing else", which is
// the version that still catches the thing it was built to catch: a site that
// quietly grows a page per town.
//
// The substance of those two pages is held in place by test/local-pages.test.js,
// which measures how much prose they share.
test('the only city pages are the two that earned one', async () => {
  const allowed = new Set(LOCAL_PAGES.map((p) => '/' + p.slug));

  // The shapes a generator would produce, including the two real slugs'
  // near misses. Everything that is not one of the two must 404.
  for (const guess of ['/lowell', '/stanton', '/junk-removal-lowell', '/junk-removal-stanton',
                       '/junk-removal-near-me', '/west-michigan', '/junk-removal-belding-mi',
                       '/junk-removal-ionia-mi', '/junk-removal-grand-rapids-mi',
                       '/junk-removal-rockford-mi', '/junk-removal-alto-mi',
                       '/cleanouts-lowell-mi', '/estate-cleanouts-stanton-mi']) {
    if (allowed.has(guess)) continue;
    assert.equal((await app.get(guess)).status, 404, guess + ' must not exist');
  }

  // Exactly the two in the sitemap, and nothing else naming a city.
  const xml = await (await app.get('/sitemap.xml')).text();
  const cityUrls = [...xml.matchAll(/<loc>([^<]*-mi)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(cityUrls, LOCAL_PAGES.map((p) => SITE + '/' + p.slug));

  // And neither of them is thin. A city page below this is a stub pretending
  // to be a page.
  for (const page of LOCAL_PAGES) {
    const words = bodyText(await html('/' + page.slug)).split(' ').length;
    assert.ok(words > 900, '/' + page.slug + ' is thin at ' + words + ' words');
  }
});

test('a city page is not another city page with the name swapped', async () => {
  const [a, b] = LOCAL_PAGES.map((p) => p.slug);
  const textA = bodyText(await html('/' + a)).toLowerCase();
  const textB = bodyText(await html('/' + b)).toLowerCase();

  // The same vocabulary measure the service pages are held to. Two pages about
  // the same business in two towns will share a lot of words legitimately --
  // the services, the limits, the way a quote works -- so the bar here is the
  // same 0.6 the service pages pass, and a swapped-noun template lands near 1.
  const setA = new Set(textA.split(' '));
  const setB = new Set(textB.split(' '));
  const shared = [...setA].filter((w) => setB.has(w)).length;
  const overlap = shared / (setA.size + setB.size - shared);
  assert.ok(overlap < 0.6, `${a} and ${b} overlap ${overlap.toFixed(2)} — too alike`);

  // Swapping the city name in one page must not produce the other. This is
  // the literal definition of the thing being guarded against.
  const swapped = textA
    .replaceAll(LOCAL_PAGES[0].city.toLowerCase(), LOCAL_PAGES[1].city.toLowerCase())
    .replaceAll(LOCAL_PAGES[0].county.toLowerCase(), LOCAL_PAGES[1].county.toLowerCase());
  assert.notEqual(swapped, textB, 'one page is the other with the nouns swapped');
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

  for (const invented of ['address', 'openingHours', 'priceRange',
                          'aggregateRating', 'review', 'award']) {
    assert.ok(!(invented in business), 'must not invent ' + invented);
  }

  // The entity is formed, so it may be named. The registered address is
  // residential and must still appear nowhere.
  assert.equal(business.legalName, 'RYDJA LLC');

  // Hours are confirmed off the Business Profile by the owner and recorded in
  // business-listing-master.md §7: seven days, 7 AM to 7 PM, same every day.
  // They are published in the footer too -- markup that describes something a
  // visitor cannot also read is the thing we were avoiding by omitting them.
  const hours = business.openingHoursSpecification;
  assert.equal(hours.length, 1, 'one specification covers hours that do not vary');
  assert.equal(hours[0]['@type'], 'OpeningHoursSpecification');
  assert.deepEqual(hours[0].dayOfWeek, [
    'https://schema.org/Monday', 'https://schema.org/Tuesday', 'https://schema.org/Wednesday',
    'https://schema.org/Thursday', 'https://schema.org/Friday', 'https://schema.org/Saturday',
    'https://schema.org/Sunday'
  ]);
  assert.equal(hours[0].opens, '07:00');
  assert.equal(hours[0].closes, '19:00');
  assert.match(home, /7 AM – 7 PM|7 AM &ndash; 7 PM/, 'the hours must be readable on the page too');
});

test('the referral page is indexable and linked, but is not a service offer', async () => {
  const doc = await html(PROFESSIONALS);

  const blocks = [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]));

  // Breadcrumbs, yes. A Service, no: it offers no distinct job of its own.
  assert.ok(blocks.find((b) => b['@type'] === 'BreadcrumbList'), 'it needs breadcrumbs');
  assert.ok(!blocks.find((b) => b['@type'] === 'Service'), 'it is not a service and must not claim to be one');

  // And it is not in the offer catalog either.
  const home = JSON.parse((await html('/')).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const offered = home.hasOfferCatalog.itemListElement.map((o) => o.itemOffered.url);
  assert.ok(!offered.includes(SITE + PROFESSIONALS), 'the referral page is not an offer');
  assert.equal(offered.length, SERVICE_PAGES.length);

  // Reachable from the pages a professional would actually land on first.
  for (const from of ['/', '/services', '/estate-cleanouts', '/rental-property-cleanouts', '/service-area']) {
    assert.ok((await html(from)).includes('href="' + PROFESSIONALS + '"'), from + ' should link ' + PROFESSIONALS);
  }
});

test('the referral page claims no credential nobody has verified', async () => {
  const text = bodyText(await html(PROFESSIONALS)).toLowerCase();

  // The page states plainly what it does NOT claim, which is the opposite of
  // a claim -- so the bare words "licensed", "insured" and "certified" are
  // expected to appear. What must not appear is any of them as an assertion.
  for (const claim of ['we are insured', 'we are bonded', 'we are licensed', 'we are certified',
                       'we are accredited', 'fully insured', 'fully licensed', 'licensed and insured',
                       'bonded and insured', 'licensed, bonded', 'rydja is insured', 'rydja is licensed',
                       'years in business', 'years of experience', 'award-winning', 'five-star', '5-star',
                       'satisfaction guaranteed', 'guaranteed lowest']) {
    assert.ok(!text.includes(claim), PROFESSIONALS + ' must not claim: ' + claim);
  }

  // And it does say so, in as many words, because a vendor page is exactly
  // where somebody would otherwise assume it.
  assert.match(text, /does not claim to be insured, bonded, licensed, accredited or certified/);

  // The entity may be named. Nothing private about it may be.
  assert.ok(text.includes('rydja llc'), 'the formed entity may be named where it is useful');
  assert.doesNotMatch(text, /\b\d{2}-\d{7}\b/, 'an EIN must never be published');
  assert.doesNotMatch(text, /\b\d{3}-\d{2}-\d{4}\b/, 'an SSN must never be published');
});

test('no public page publishes a tax identifier or a private address', async () => {
  for (const path of INDEXABLE) {
    const doc = await html(path);
    assert.doesNotMatch(doc, /\b\d{2}-\d{7}\b/, path + ' looks like it carries an EIN');
    assert.doesNotMatch(doc, /\b\d{3}-\d{2}-\d{4}\b/, path + ' looks like it carries an SSN');
    for (const word of ['EIN', 'Employer Identification', 'Social Security', 'Tax ID', 'W-9 attached']) {
      assert.ok(!doc.includes(word), path + ' mentions ' + word);
    }
    // No street address for the business anywhere in the markup.
    assert.doesNotMatch(doc, /"streetAddress"/, path + ' must not publish a street address');
    assert.doesNotMatch(doc, /"PostalAddress"/, path + ' must not publish a postal address');
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
    '/img/josh-owner-rydja.jpg', '/img/josh-owner-rydja.webp',
    // Licensed stock, cropped and sized locally. Provenance is recorded in the
    // private asset manifest and credited on /image-credits.
    '/img/estate-cleanout-boxes.jpg', '/img/estate-cleanout-boxes.webp',
    '/img/garage-cleanout.jpg', '/img/garage-cleanout.webp'
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

// ---------------------------------------------------------------- social profiles

// The two URLs exactly as they are set in production, share-sheet tracking
// parameter and all, so that what these tests exercise is the value the
// environment really holds rather than a tidied-up version of it.
const FB_ENV = 'https://www.facebook.com/share/1BXxZTv6Qc/?mibextid=wwXIfr';
const IG_ENV = 'https://www.instagram.com/rydjaservices/';
const FB = 'https://www.facebook.com/share/1BXxZTv6Qc/';
const IG = IG_ENV;

const socialHrefs = (doc, host) =>
  doc.match(new RegExp('<a[^>]*href="https://[^"]*' + host + '[^"]*"[^>]*>', 'g')) || [];

test('both social profiles are linked publicly, safely, and with no tracking', async () => {
  const home = await html('/');

  assert.ok(home.includes(FB), 'the homepage should link the Facebook page');
  assert.ok(home.includes(IG), 'the homepage should link the Instagram profile');
  assert.match(home, /Follow RYDJA on Facebook/, 'the footer needs a labelled Facebook link');
  assert.match(home, /Follow RYDJA on Instagram/, 'the footer needs a labelled Instagram link');

  // Every link to either profile opens safely in a new tab.
  for (const tag of [...socialHrefs(home, 'facebook\\.com'), ...socialHrefs(home, 'instagram\\.com')]) {
    assert.match(tag, /target="_blank"/, 'social link should open in a new tab: ' + tag);
    assert.match(tag, /rel="[^"]*noopener/, 'social link needs rel=noopener: ' + tag);
    assert.match(tag, /rel="[^"]*noreferrer/, 'social link needs rel=noreferrer: ' + tag);
  }

  // Inherited by the shared footer on every public page.
  for (const path of INDEXABLE) {
    const doc = await html(path);
    assert.ok(doc.includes(FB), path + ' should carry the footer Facebook link');
    assert.ok(doc.includes(IG), path + ' should carry the footer Instagram link');
  }
});

test('the footer links each profile once, not twice', async () => {
  for (const path of INDEXABLE) {
    const doc = await html(path);
    const footer = doc.slice(doc.indexOf('<footer'));
    assert.equal(socialHrefs(footer, 'facebook\\.com').length, 1, path + ': one Facebook link in the footer');
    assert.equal(socialHrefs(footer, 'instagram\\.com').length, 1, path + ': one Instagram link in the footer');
  }
});

// The owner section names both profiles too. It is a separate block from the
// footer, so it gets its own slice and its own counting: the footer carrying
// the links is not evidence that the owner section does.
const ownerSection = (doc) => {
  const start = doc.indexOf('<section id="owner"');
  assert.ok(start > -1, 'the homepage should still have an owner section');
  return doc.slice(start, doc.indexOf('</section>', start));
};

test('the owner section names each profile once, and links it safely', async () => {
  const owner = ownerSection(await html('/'));

  const fb = socialHrefs(owner, 'facebook\\.com');
  const ig = socialHrefs(owner, 'instagram\\.com');
  assert.equal(fb.length, 1, 'Facebook appears once in the owner section');
  assert.equal(ig.length, 1, 'Instagram appears once in the owner section');

  // The configured values, normalised -- not a URL written into the template.
  assert.ok(owner.includes('href="' + FB + '"'), 'the owner section uses the configured Facebook URL');
  assert.ok(owner.includes('href="' + IG + '"'), 'the owner section uses the configured Instagram URL');
  assert.ok(!owner.includes('mibextid'), 'no tracking parameter in the owner section');

  for (const tag of [...fb, ...ig]) {
    assert.match(tag, /target="_blank"/, 'owner-section social link opens in a new tab: ' + tag);
    assert.match(tag, /rel="noopener noreferrer me"/, 'owner-section social link needs the full rel: ' + tag);
  }

  // Labelled in words, with the icon decorative -- the link still reads
  // correctly with images off or to a screen reader.
  assert.match(owner, /<span>RYDJA on Facebook<\/span>/);
  assert.match(owner, /<span>RYDJA on Instagram<\/span>/);
  assert.equal((owner.match(/<svg[^>]*class="social-icon"/g) || []).length, 2, 'one icon per link');
  assert.equal((owner.match(/<svg[^>]*aria-hidden="true"/g) || []).length, 2, 'both icons are decorative');

  // The copy around them is untouched, and still a sentence.
  const sentence = owner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  assert.match(sentence, /See recent work and updates on RYDJA on Facebook and RYDJA on Instagram\./);
  assert.match(sentence, /RYDJA is owner-operated/, 'the owner copy is unchanged');
  assert.match(sentence, /Josh &mdash; Owner\/Operator/, 'the owner credit is unchanged');
});

test('the owner section drops only the profile that is unset', async () => {
  // Instagram alone: the sentence loses the Facebook half and still reads.
  const igOnly = await startServer({ SITE_URL: SITE, FACEBOOK_URL: ' ', INSTAGRAM_URL: IG_ENV });
  try {
    const owner = ownerSection(await (await igOnly.get('/')).text());
    assert.equal(socialHrefs(owner, 'facebook\\.com').length, 0, 'no Facebook link in the owner section');
    assert.equal(socialHrefs(owner, 'instagram\\.com').length, 1, 'Instagram survives on its own');
    const sentence = owner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    assert.match(sentence, /See recent work and updates on RYDJA on Instagram\./);
    assert.ok(!/ and RYDJA/.test(sentence), 'no dangling conjunction with one profile');
  } finally {
    igOnly.stop();
  }

  // Facebook alone: what the page did before Instagram existed.
  const fbOnly = await startServer({ SITE_URL: SITE, FACEBOOK_URL: FB_ENV, INSTAGRAM_URL: '' });
  try {
    const owner = ownerSection(await (await fbOnly.get('/')).text());
    assert.equal(socialHrefs(owner, 'instagram\\.com').length, 0, 'no Instagram link in the owner section');
    assert.equal(socialHrefs(owner, 'facebook\\.com').length, 1, 'Facebook survives on its own');
    const sentence = owner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
    assert.match(sentence, /See recent work and updates on RYDJA on Facebook\./);
    assert.ok(!/ and RYDJA/.test(sentence), 'no dangling conjunction with one profile');
  } finally {
    fbOnly.stop();
  }

  // Neither: the whole sentence goes rather than trailing into nothing.
  const none = await startServer({ SITE_URL: SITE, FACEBOOK_URL: ' ', INSTAGRAM_URL: ' ' });
  try {
    const owner = ownerSection(await (await none.get('/')).text());
    assert.ok(!owner.includes('See recent work and updates on'), 'no lead-in with nothing to lead into');
    assert.match(owner, /RYDJA is owner-operated/, 'the rest of the owner section is unaffected');
  } finally {
    none.stop();
  }
});

test('the share-sheet tracking parameter is stripped before anything is published', async () => {
  // The configured Facebook URL is a share link, and a share link carries a
  // click-tracking parameter. Publishing it on a site whose privacy policy
  // says it runs no tracking would be a small lie.
  for (const path of ['/', '/privacy']) {
    const doc = await html(path);
    assert.ok(!doc.includes('mibextid'), path + ' must not carry a Facebook tracking parameter');
    assert.ok(!doc.includes('igsh'), path + ' must not carry an Instagram tracking parameter');
    assert.ok(!doc.includes('facebook.net'), path + ' must not load the Facebook SDK');
    assert.ok(!doc.includes('connect.facebook'), path + ' must not load a Facebook pixel');
    assert.ok(!doc.includes('instagram.com/embed'), path + ' must not load an Instagram embed');
    assert.ok(!doc.includes('platform.instagram.com'), path + ' must not load the Instagram SDK');
  }
});

test('sameAs lists both profiles, once each, and nothing invented', async () => {
  const doc = await html('/');
  const biz = JSON.parse(doc.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

  assert.ok(Array.isArray(biz.sameAs), 'sameAs should be an array');
  assert.deepEqual(biz.sameAs, [FB, IG]);
  assert.equal(new Set(biz.sameAs).size, biz.sameAs.length, 'no profile listed twice');

  // The tracking parameter must not survive into the structured data either:
  // sameAs is the URL we are telling search engines is our canonical profile.
  assert.ok(!JSON.stringify(biz.sameAs).includes('mibextid'));

  // Only accounts that actually exist. No placeholder profiles.
  for (const guess of ['twitter.com', 'linkedin.com', 'youtube.com', 'yelp.com', 'tiktok.com']) {
    assert.ok(!JSON.stringify(biz.sameAs).includes(guess), 'sameAs must not invent a ' + guess + ' profile');
  }
});

test('each social link can be configured independently, and disappears when unset', async () => {
  // Instagram alone: the Facebook link goes, the Instagram one stays, and
  // sameAs shrinks to match rather than carrying an empty entry.
  const igOnly = await startServer({ SITE_URL: SITE, FACEBOOK_URL: ' ', INSTAGRAM_URL: IG_ENV });
  try {
    const doc = await (await igOnly.get('/')).text();
    assert.ok(!doc.includes('facebook.com'), 'no Facebook link when its URL is unset');
    assert.ok(doc.includes(IG), 'the Instagram link is unaffected');
    const biz = JSON.parse(doc.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(biz.sameAs, [IG]);
  } finally {
    igOnly.stop();
  }

  // Facebook alone.
  const fbOnly = await startServer({ SITE_URL: SITE, FACEBOOK_URL: FB_ENV, INSTAGRAM_URL: '' });
  try {
    const doc = await (await fbOnly.get('/')).text();
    assert.ok(!doc.includes('instagram.com'), 'no Instagram link when its URL is unset');
    assert.ok(doc.includes(FB), 'the Facebook link is unaffected');
    const biz = JSON.parse(doc.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(biz.sameAs, [FB]);
  } finally {
    fbOnly.stop();
  }

  // Neither: no social area at all, and no empty sameAs in the structured data.
  const none = await startServer({ SITE_URL: SITE, FACEBOOK_URL: ' ', INSTAGRAM_URL: ' ' });
  try {
    const doc = await (await none.get('/')).text();
    assert.ok(!doc.includes('facebook.com'), 'no link when the URL is unset');
    assert.ok(!doc.includes('instagram.com'), 'no link when the URL is unset');
    assert.ok(!doc.includes('class="social"'), 'the social list is absent, not empty');
    const biz = JSON.parse(doc.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.ok(!('sameAs' in biz), 'no empty sameAs in the structured data');
  } finally {
    none.stop();
  }
});

test('a social URL that is not a publishable https URL links nothing', async () => {
  // A typo, a scheme that is not https, or something pasted in by mistake: the
  // link is dropped rather than put in front of a visitor.
  for (const junk of ['not-a-url', 'javascript:alert(1)', 'http://www.facebook.com/rydja']) {
    const srv = await startServer({ SITE_URL: SITE, FACEBOOK_URL: junk, INSTAGRAM_URL: ' ' });
    try {
      const doc = await (await srv.get('/')).text();
      assert.ok(!doc.includes('class="social-link"'), 'no social link for ' + junk);
      assert.ok(!doc.includes('javascript:'), 'never a javascript: href');
      const biz = JSON.parse(doc.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      assert.ok(!('sameAs' in biz), 'nothing unpublishable reaches sameAs: ' + junk);
    } finally {
      srv.stop();
    }
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

// ---------------------------------------------------------- internal linking

// The link map, asserted rather than trusted. Internal links are the whole
// mechanism by which a visitor who lands on the wrong page reaches the right
// one, and by which crawl equity reaches a page nobody links from outside.
//
// Each entry is "this page must link onward to these". Pinned here because
// the links live in several places -- page data, prose, templates -- and a
// rewrite of any one of them can quietly drop one.
const LINK_MAP = {
  '/': ['/services', '/service-area', '/quote', '/property-professionals',
        ...SERVICE_PATHS],
  '/services': [...SERVICE_PATHS, '/property-professionals', '/service-area', '/quote'],
  '/junk-removal': ['/furniture-appliance-removal', '/cleanouts', '/yard-cleanup',
                    '/rental-property-cleanouts', '/estate-cleanouts', '/hauling-moving-help'],
  '/cleanouts': ['/estate-cleanouts', '/rental-property-cleanouts', '/junk-removal',
                 '/light-demolition', '/furniture-appliance-removal'],
  '/estate-cleanouts': ['/cleanouts', '/property-professionals', '/hauling-moving-help',
                        '/light-demolition', '/rental-property-cleanouts', '/junk-removal'],
  '/rental-property-cleanouts': ['/cleanouts', '/junk-removal', '/furniture-appliance-removal',
                                 '/property-professionals', '/estate-cleanouts'],
  '/property-professionals': ['/estate-cleanouts', '/rental-property-cleanouts', '/cleanouts',
                              '/junk-removal', '/yard-cleanup', '/light-demolition',
                              '/furniture-appliance-removal', '/services', '/service-area'],
  '/yard-cleanup': ['/junk-removal', '/light-demolition', '/cleanouts', '/hauling-moving-help'],
  '/furniture-appliance-removal': ['/junk-removal', '/cleanouts', '/rental-property-cleanouts',
                                   '/hauling-moving-help'],
  '/hauling-moving-help': ['/junk-removal', '/furniture-appliance-removal', '/estate-cleanouts',
                           '/yard-cleanup'],
  '/light-demolition': ['/junk-removal', '/yard-cleanup', '/cleanouts', '/estate-cleanouts'],
  '/service-area': [...SERVICE_PATHS, '/property-professionals', '/quote']
};

test('every page links onward to the pages it should, and never to itself', async () => {
  for (const [from, targets] of Object.entries(LINK_MAP)) {
    const doc = await html(from);
    for (const to of targets) {
      assert.ok(doc.includes('href="' + to + '"') || doc.includes('href="' + to + '?'),
        from + ' should link ' + to);
    }
    // A page is never its own related work. The footer links /services and
    // /quote from everywhere, so those two are exempt from the self-link rule.
    if (!['/services', '/quote'].includes(from)) {
      const body = doc.slice(doc.indexOf('<main'), doc.indexOf('</main>'));
      assert.ok(!body.includes('href="' + from + '"'), from + ' links to itself in its own body');
    }
  }
});

test('internal anchor text describes the destination rather than repeating a keyword', async () => {
  for (const page of SERVICE_PAGES) {
    for (const rel of page.related) {
      assert.ok(rel.label.split(' ').length >= 3, '/' + page.slug + ' anchor is too terse: ' + rel.label);
      assert.ok(!/^click here|^read more|^learn more|^here$/i.test(rel.label.trim()),
        '/' + page.slug + ' uses a generic anchor: ' + rel.label);
    }
  }

  // And across every public page: no bare "click here" anywhere.
  for (const path of INDEXABLE) {
    const doc = await html(path);
    for (const [, text] of doc.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) {
      const label = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      assert.ok(!/^(click here|here|this|read more|more)$/i.test(label),
        path + ' has a generic link label: ' + JSON.stringify(label));
    }
  }
});

test('no internal link on a public page is broken', async () => {
  const seen = new Set();

  for (const path of INDEXABLE) {
    const doc = await html(path);
    for (const [, href] of doc.matchAll(/href="(\/[^"#]*)"/g)) {
      const target = href.split('?')[0];
      if (!target || target.startsWith('/admin') || target.startsWith('/q/') || seen.has(target)) continue;
      seen.add(target);
      const res = await app.get(target);
      assert.ok(res.status === 200, path + ' links ' + target + ', which answers ' + res.status);
    }
  }

  assert.ok(seen.size > 15, 'this should have walked the whole public site, saw ' + seen.size);
});

// ----------------------------------------------------------- escaped copy

// The bug this catches, caught once already: an em dash written as the HTML
// entity `&mdash;` inside a field the template renders with <%= %> rather
// than <%- %>. EJS escapes the ampersand, the browser renders `&mdash;`
// literally, and a service card reads "hauled off &mdash; by us, not by you".
//
// It is invisible in the source, invisible in a diff, and perfectly visible
// to every customer. Content modules guard their own fields at require time;
// this is the backstop that also covers copy written straight into a template.
test('no page shows an HTML entity to the reader as its own source', async () => {
  for (const path of INDEXABLE) {
    const doc = await html(path);

    const doubled = [...new Set([...doc.matchAll(/&amp;[a-zA-Z#][a-zA-Z0-9]*;/g)].map((m) => m[0]))];
    assert.deepEqual(doubled, [], path + ' renders a double-escaped entity: ' + doubled.join(', '));

    // And the same mistake inside an attribute value, where it is even easier
    // to miss because nothing on the page looks wrong -- it is the search
    // result and the share card that carry it.
    for (const attr of ['name="description"', 'property="og:description"', 'property="og:title"',
                        'name="twitter:description"', 'name="twitter:title"']) {
      const m = doc.match(new RegExp('<meta ' + attr + ' content="([^"]*)"'));
      if (!m) continue;
      assert.doesNotMatch(m[1], /&amp;[a-zA-Z#][a-zA-Z0-9]*;/, path + ' ' + attr + ': ' + m[1]);
    }

    const title = meta(doc, /<title>([^<]*)<\/title>/);
    assert.doesNotMatch(title, /&amp;[a-zA-Z#][a-zA-Z0-9]*;/, path + ' title: ' + title);
  }
});
