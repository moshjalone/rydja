'use strict';

// The two city pages, and the rules that stop there being twenty of them.
//
// A city page is the highest-risk page on a site like this. Done honestly it
// is the single best answer to "junk removal lowell mi", which is what a
// person in Lowell actually types. Done lazily it is a doorway page: the same
// copy with the name swapped, multiplied by every town within fifty miles,
// and it earns the site a manual action rather than a ranking.
//
// So the load-bearing test in here is not "the page exists". It is the overlap
// test: it measures how much of one city page's authored prose also appears on
// the other, and fails when they start converging. That is the mechanical
// version of the rule written at the top of content/local-pages.js, and it is
// what a third page would have to pass.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const { LOCAL_PAGES, localPage, linkedServiceSlugs } = require('../content/local-pages');
const { SERVICE_PAGES } = require('../content/service-pages');

const SITE_URL = 'https://getrydja.com';
const PHONE = '1-616-929-3360';

let app;

test.before(async () => {
  app = await startServer({ SITE_URL, BUSINESS_PHONE: PHONE });
});

test.after(() => app?.stop());

const html = async (url) => (await app.get(url)).text();

/** The visible words of a page, with markup and entities out of the way. */
function visibleText(doc) {
  return doc
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&rsquo;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every sentence of prose a page author actually wrote for one city.
 *
 * Deliberately taken from the content file rather than from the rendered page.
 * The rendered page also contains the header, the footer, the shared "what we
 * can't take" list and the shared four-step explanation -- all of which are
 * identical across both pages on purpose, because they are facts about the
 * business rather than about the city. Comparing rendered pages would measure
 * that shared furniture and tell us nothing.
 */
function authoredSentences(page) {
  const prose = [
    page.lede,
    ...page.intro,
    page.localHeading,
    ...page.local.flatMap((s) => [s.h, s.p]),
    ...page.services.map((entry) => entry[1]),
    page.nearbyHeading,
    page.nearbyNote,
    ...page.faqs.flatMap((f) => [f.q, f.a]),
    page.closing
  ].join(' ');

  return prose
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim())
    // Very short fragments are headings and connectives; they carry no
    // substance and would make the overlap figure noise.
    .filter((s) => s.split(' ').length >= 6);
}

// ------------------------------------------------- the doorway-page guard

test('the two city pages are not one page with the name swapped', () => {
  assert.equal(LOCAL_PAGES.length, 2, 'two pages; a third has a rule to satisfy first');

  const [a, b] = LOCAL_PAGES.map(authoredSentences);
  assert.ok(a.length >= 25, 'a city page needs real substance, not three paragraphs');
  assert.ok(b.length >= 25, 'and so does the other one');

  const inB = new Set(b);
  const shared = a.filter((s) => inB.has(s));
  const overlap = shared.length / a.length;

  assert.ok(
    overlap < 0.1,
    'the two city pages share ' +
      Math.round(overlap * 100) +
      '% of their authored sentences, which is how a doorway page starts. Shared: ' +
      shared.slice(0, 3).join(' | ')
  );

  // The same thing said at the level of whole sections: no two local sections
  // across the two pages may carry the same heading.
  const headings = LOCAL_PAGES.flatMap((p) => p.local.map((s) => s.h.toLowerCase()));
  assert.equal(new Set(headings).size, headings.length, 'a shared local heading means shared local content');

  // And the questions. If both pages ask and answer the same things, the
  // local sections are decoration.
  const questions = LOCAL_PAGES.flatMap((p) => p.faqs.map((f) => f.q.toLowerCase()));
  const uniqueQuestions = new Set(questions);
  assert.ok(
    uniqueQuestions.size >= questions.length - 1,
    'at most one question may be common to both cities'
  );
});

test('each page names something that is specifically true of its own place', () => {
  const lowell = localPage('junk-removal-lowell-mi');
  const stanton = localPage('junk-removal-stanton-mi');

  assert.equal(lowell.county, 'Kent County');
  assert.equal(stanton.county, 'Montcalm County');
  assert.notEqual(lowell.county, stanton.county, 'two counties is half the reason both pages exist');

  // The specific, checkable local facts each page is built on. If somebody
  // rewrites a page into generic copy, these go first.
  const lowellText = JSON.stringify(lowell).toLowerCase();
  for (const fact of ['flat river', 'grand', 'pole barn', 'grand rapids']) {
    assert.ok(lowellText.includes(fact), 'the Lowell page should mention: ' + fact);
  }

  const stantonText = JSON.stringify(stanton).toLowerCase();
  for (const fact of ['county seat', 'probate', 'montcalm', 'outbuilding']) {
    assert.ok(stantonText.includes(fact), 'the Stanton page should mention: ' + fact);
  }

  // Neither may be about the other.
  assert.ok(!stantonText.includes('flat river'), 'the Stanton page is not about Lowell');
});

// ------------------------------------------------- a page is a coverage claim

test('no city has a page unless we have said we serve it', async () => {
  // The declared service area, as the structured data publishes it. A city
  // page claims coverage in a way a bulleted list does not, so a page for a
  // place that is not on this list would be a promise nobody made.
  const home = await html('/');
  const block = home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  const served = JSON.parse(block).areaServed.map((p) => p.name.toLowerCase());

  for (const page of LOCAL_PAGES) {
    const claim = (page.city + ', ' + page.state).toLowerCase();
    assert.ok(
      served.includes(claim),
      page.city + ' has a page but is not in the declared service area: ' + served.join(', ')
    );
  }
});

test('nothing on a city page invents a price, a review, a credential or a promise', async () => {
  for (const page of LOCAL_PAGES) {
    const text = visibleText(await html('/' + page.slug)).toLowerCase();

    // Claims the business has not earned and the rest of the site refuses to
    // make. A city page is exactly where this kind of thing gets added by
    // somebody chasing a ranking.
    // The bare words "licensed" and "certified" are expected: both pages say
    // that licensed abatement work is somebody else's, and that loads go to a
    // licensed disposal site. Those are statements about a third party. What
    // must not appear is any of them as an assertion about RYDJA -- the same
    // distinction the referral-page test already draws.
    for (const claim of ['we are licensed', 'we are insured', 'we are bonded', 'we are certified',
                         'we are accredited', 'fully insured', 'fully licensed', 'licensed and insured',
                         'bonded and insured', 'licensed, bonded', 'rydja is insured', 'rydja is licensed',
                         'same day', 'same-day', 'within 24 hours', 'guaranteed',
                         'best in', '#1', 'number one', 'top rated', 'top-rated',
                         '5-star', 'five star', 'five-star', 'free estimate',
                         'cheapest', 'lowest price', 'beat any price', 'award-winning',
                         'years of experience', 'years in business']) {
      assert.ok(!text.includes(claim), page.slug + ' must not claim: ' + claim);
    }

    // No price, in any shape. Every job is quoted individually and a figure
    // on a city page would be the one number nobody could stand behind.
    assert.doesNotMatch(text, /\$\s?\d/, page.slug + ' must not carry a price');
    assert.doesNotMatch(text, /\bstarting at\b|\bfrom only\b|\bper load\b.*\$/, page.slug);

    // No review or rating claim. The Business Profile has real reviews; the
    // website is not the place to restate a number nobody here can verify.
    assert.doesNotMatch(text, /\d+(\.\d+)?\s*(star|\/\s*5)/, page.slug + ' must not quote a rating');
    assert.doesNotMatch(text, /\b\d+\+?\s+(reviews|customers|jobs completed)\b/, page.slug);

    // And no address. The registered one is residential.
    assert.doesNotMatch(text, /\b\d{1,5}\s+[A-Za-z]+\s+(st|street|ave|avenue|rd|road|dr|drive)\b/i,
      page.slug + ' must not publish a street address');
  }
});

// ------------------------------------------------- the pages themselves

test('each city page answers 200 with the metadata we meant', async () => {
  const titles = new Set();
  const descriptions = new Set();

  for (const page of LOCAL_PAGES) {
    const res = await app.get('/' + page.slug);
    assert.equal(res.status, 200, page.slug);
    const doc = await res.text();

    assert.equal((doc.match(/<h1/g) || []).length, 1, page.slug + ' needs exactly one h1');
    assert.ok(doc.includes('<h1>' + page.h1 + '</h1>'), page.slug + ' h1');

    const title = doc.match(/<title>([^<]*)<\/title>/)[1];
    assert.ok(title.includes(page.city), page.slug + ' title must name the city');
    titles.add(title);

    const description = doc.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.ok(description.length > 80 && description.length < 320, page.slug + ' description length');
    assert.ok(description.includes(page.city), page.slug + ' description must name the city');
    descriptions.add(description);

    assert.match(doc, new RegExp('<link rel="canonical" href="' + SITE_URL + '/' + page.slug + '">'));

    // The city and the county are both on the page a visitor reads, not only
    // in the markup a crawler reads.
    const text = visibleText(doc);
    assert.ok(text.includes(page.city), page.slug + ' should say the city');
    assert.ok(text.includes(page.county), page.slug + ' should say the county');

    // Long enough to be a page rather than a stub.
    assert.ok(text.split(' ').length > 900, page.slug + ' is too thin to deserve to exist');
  }

  assert.equal(titles.size, LOCAL_PAGES.length, 'two pages must not share a title');
  assert.equal(descriptions.size, LOCAL_PAGES.length, 'nor a description');
});

test('a trailing slash redirects rather than becoming a second URL', async () => {
  for (const page of LOCAL_PAGES) {
    const res = await app.get('/' + page.slug + '/');
    assert.equal(res.status, 301, page.slug);
    assert.equal(res.headers.get('location'), '/' + page.slug);
  }
});

test('every service a city page links to is a real page', async () => {
  const known = new Set(SERVICE_PAGES.map((p) => p.slug));
  for (const slug of linkedServiceSlugs()) {
    assert.ok(known.has(slug), slug + ' is linked from a city page and is not a service');
    assert.equal((await app.get('/' + slug)).status, 200, '/' + slug);
  }

  // And the link text comes off the service catalog rather than being written
  // twice, so a service cannot be called two things on one site.
  const doc = await html('/' + LOCAL_PAGES[0].slug);
  for (const slug of LOCAL_PAGES[0].services.map((e) => e[0])) {
    const service = SERVICE_PAGES.find((p) => p.slug === slug);
    // Escaped as the template renders it: "Garage, Basement & Property
    // Cleanouts" reaches the page with an &amp; in it.
    const rendered = service.card.title.replace(/&/g, '&amp;');
    assert.ok(
      doc.includes('>' + rendered + '</a>'),
      'the link to /' + slug + ' should use the catalog title: ' + service.card.title
    );
  }
});

test('the CTA prefills a service the quote form actually offers', async () => {
  for (const page of LOCAL_PAGES) {
    const doc = await html('/' + page.slug);
    const prefill = encodeURIComponent(page.quoteService);
    assert.ok(doc.includes('/quote?service=' + prefill), page.slug + ' CTA');

    // Follow it: the form has to come back with that option selected, or the
    // link is decoration.
    const form = await html('/quote?service=' + prefill);
    assert.ok(
      form.includes(' selected>' + page.quoteService + '</option>'),
      page.slug + ' prefills "' + page.quoteService + '", which the form did not select'
    );
  }
});

// ------------------------------------------------- structured data

test('the structured data describes one business in two places, not two businesses', async () => {
  for (const page of LOCAL_PAGES) {
    const doc = await html('/' + page.slug);
    const blocks = [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]));

    assert.equal(blocks.length, 3, page.slug + ' should carry Service, BreadcrumbList and FAQPage');
    const types = blocks.map((b) => b['@type']);
    assert.deepEqual(types, ['Service', 'BreadcrumbList', 'FAQPage']);

    const [service] = blocks;
    // One business node, referenced by id. Not a second LocalBusiness per
    // city -- that is how one truck comes to look like a chain of branches.
    assert.equal(service.provider['@id'], SITE_URL + '/#business');
    assert.ok(!JSON.stringify(blocks).includes('"LocalBusiness"'), page.slug + ' must not mint a branch');
    assert.ok(!JSON.stringify(blocks).includes('address'), page.slug + ' must publish no address');
    assert.ok(!JSON.stringify(blocks).includes('aggregateRating'), page.slug + ' must invent no rating');
    assert.ok(!JSON.stringify(blocks).includes('priceRange'), page.slug + ' must invent no price');

    assert.equal(service.areaServed['@type'], 'City');
    assert.equal(service.areaServed.name, page.city);
    assert.ok(service.areaServed.containedInPlace.name.includes(page.county));

    // The trail is Home > Service Area > this city, and the rendered
    // breadcrumb says the same thing.
    const [, crumbs] = blocks;
    assert.deepEqual(
      crumbs.itemListElement.map((i) => i.name),
      ['Home', 'Service Area', page.nav]
    );
    assert.match(doc, /<nav class="crumbs"[\s\S]*?href="\/service-area">Service Area<\/a>/);
  }
});

test('every FAQ answer in the markup is an answer a visitor can read on the page', async () => {
  for (const page of LOCAL_PAGES) {
    const doc = await html('/' + page.slug);
    const faq = [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1]))
      .find((b) => b['@type'] === 'FAQPage');

    assert.equal(faq.mainEntity.length, page.faqs.length, page.slug + ' question count');

    const text = visibleText(doc);
    for (const entry of faq.mainEntity) {
      assert.ok(text.includes(entry.name), page.slug + ' asks in markup but not on the page: ' + entry.name);
      // The first clause of the answer is enough: the point is that the text
      // is on the page, not that it matches byte for byte after entities.
      const opening = entry.acceptedAnswer.text.split(/[.,—]/)[0].trim();
      assert.ok(
        text.includes(opening),
        page.slug + ' answers in markup but not on the page: ' + opening.slice(0, 50)
      );
    }
  }
});

// ------------------------------------------------- how they are reached

test('the city pages are in the sitemap and reachable from the site', async () => {
  const sitemap = await html('/sitemap.xml');
  for (const page of LOCAL_PAGES) {
    assert.ok(sitemap.includes(SITE_URL + '/' + page.slug), page.slug + ' is missing from the sitemap');
  }

  // /service-area owns places, so it leads to both.
  const area = await html('/service-area');
  for (const page of LOCAL_PAGES) {
    assert.ok(area.includes('href="/' + page.slug + '"'), '/service-area should link ' + page.slug);
  }

  // And the footer carries them, so they are one click from anywhere.
  for (const from of ['/', '/quote', '/junk-removal', '/estate-cleanouts']) {
    const doc = await html(from);
    for (const page of LOCAL_PAGES) {
      assert.ok(doc.includes('href="/' + page.slug + '"'), from + ' footer should link ' + page.slug);
    }
  }
});

test('the city pages are indexable, with no noindex from the new template', async () => {
  for (const page of LOCAL_PAGES) {
    const doc = await html('/' + page.slug);
    assert.ok(!doc.includes('name="robots"'), page.slug + ' must not be noindex');
  }
});

test('the mobile call bar appears on a city page, because it is a marketing page', async () => {
  for (const page of LOCAL_PAGES) {
    const doc = await html('/' + page.slug);
    assert.match(doc, /<body[^>]*class="has-mobile-cta"/, page.slug);
    assert.match(doc, /class="mobile-cta"/, page.slug);
    assert.ok(doc.includes('href="tel:'), page.slug + ' needs the call link');
    assert.ok(doc.includes('href="sms:'), page.slug + ' needs the text link');
  }
});

// ------------------------------------------------- the boot-time guards

test('a city page that links a service that does not exist refuses to start', async () => {
  // The guard lives in server.js and runs at boot, so the way to test it is
  // to boot a server whose content is broken. Rather than mutate the real
  // content file, this asserts the guard's own condition directly -- the
  // alternative is a test that edits a source file and has to put it back.
  const services = new Set(SERVICE_PAGES.map((p) => p.slug));
  for (const slug of linkedServiceSlugs()) assert.ok(services.has(slug));

  // No city page may take a slug a service page already has.
  for (const page of LOCAL_PAGES) {
    assert.ok(!services.has(page.slug), page.slug + ' collides with a service page');
  }

  // Nor may two city pages share one.
  const slugs = LOCAL_PAGES.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);

  // Every slug is the shape a URL wants and carries the city and the state,
  // which is what makes it match the query somebody actually types.
  for (const page of LOCAL_PAGES) {
    assert.match(page.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, page.slug);
    assert.ok(page.slug.includes(page.city.toLowerCase()), page.slug + ' should name its city');
    assert.ok(page.slug.endsWith('-mi'), page.slug + ' should carry the state, as people search it');
  }
});
