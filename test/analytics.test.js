'use strict';

// What the site measures, and -- more load-bearing -- what it refuses to.
//
// Two things are being held in place here. The first is that the numbers mean
// what the admin page says they mean: people rather than clicks, crawlers kept
// out of the visitor count, and the one figure the owner would act on counted
// on the server where a browser cannot inflate it.
//
// The second is the privacy position, which is a promise printed on a public
// page: no cookie for measurement, no IP address stored, no user-agent string
// stored, no third party contacted, and nothing in these tables that could be
// joined back to a person. Those are asserted against the database itself, not
// against the policy text, because the policy is only true if the storage is.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, freshStamp, submission, SESSION_SECRET } = require('./helpers');

const analytics = require('../analytics');
const { SERVICE_PAGES } = require('../content/service-pages');

const PHONE = '1-616-929-3360';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

let app;
let cookie;

test.before(async () => {
  app = await startServer({ SITE_URL: 'https://getrydja.com', BUSINESS_PHONE: PHONE });
  cookie = await app.adminCookie();
});

test.after(() => app?.stop());

/** Report an event the way the page script does, from a real browser. */
const event = (name, path, opts = {}) =>
  app.post(
    '/api/event',
    { name, path },
    { ip: opts.ip || '198.51.100.10', headers: { 'user-agent': opts.ua || IPHONE } }
  );

const rows = (sql, ...args) => app.read.prepare(sql).all(...args);
const one = (sql, ...args) => app.read.prepare(sql).get(...args);
const html = async (url, headers) => (await app.get(url, { headers })).text();

/**
 * Let a server-side write land before reading it.
 *
 * Only the crawler log needs this. It is written from res.on('finish'), which
 * by definition fires after the client has its response -- so a test that
 * reads the table the instant its fetch resolves is racing the server, and
 * would fail intermittently rather than wrongly. The event endpoint does not
 * need it: that one records before it answers, on purpose.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

// ------------------------------------------------- the unit under the surface

test('the visitor key is one-way, and changes every day', () => {
  const ip = '203.0.113.7';
  const ua = IPHONE;

  const monday = analytics.visitorKey(ip, ua, SESSION_SECRET, '2026-03-02');
  const tuesday = analytics.visitorKey(ip, ua, SESSION_SECRET, '2026-03-03');

  assert.match(monday, /^[0-9a-f]{16}$/, 'a short hex digest, nothing else');
  assert.equal(monday, analytics.visitorKey(ip, ua, SESSION_SECRET, '2026-03-02'), 'stable within a day');
  assert.notEqual(monday, tuesday, 'the same visitor must not be recognisable across days');

  // Different people on the same day are different keys, or it counts nothing.
  assert.notEqual(monday, analytics.visitorKey('203.0.113.8', ua, SESSION_SECRET, '2026-03-02'));

  // And the key cannot be read back. This is the whole claim the privacy
  // policy makes about it: the address is not in there in any form.
  assert.ok(!monday.includes('203'), 'the address must not survive into the key');
  for (const probe of [ip, ua, SESSION_SECRET]) {
    assert.ok(!monday.includes(probe.slice(0, 8)), 'nothing recoverable from the inputs');
  }
});

test('a crawler is told apart from a person, in both directions', () => {
  for (const ua of [GOOGLEBOT, 'Mozilla/5.0 (compatible; bingbot/2.0)', 'curl/8.4.0',
                    'facebookexternalhit/1.1', 'GPTBot/1.0', '']) {
    assert.ok(analytics.crawlerName(ua), 'should be seen as a crawler: ' + (ua || '(no user-agent)'));
  }

  // Real browsers, including the ones whose strings contain the words that
  // catch crawlers. A false positive here silently deletes real visitors from
  // the count, which is worse than a false negative.
  const browsers = [
    IPHONE,
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  ];
  for (const ua of browsers) {
    assert.equal(analytics.crawlerName(ua), null, 'should be seen as a person: ' + ua.slice(0, 40));
  }
});

test('a reported path is validated against the pages that exist', () => {
  const known = new Set(['/', '/quote', '/junk-removal']);

  assert.equal(analytics.safePath('/quote', known), '/quote');
  assert.equal(analytics.safePath('/quote?utm_source=x', known), '/quote', 'the query is dropped');
  assert.equal(analytics.safePath('/quote#form', known), '/quote', 'the fragment is dropped');

  // Everything a visitor could invent lands in one bucket rather than in the
  // table as given.
  for (const hostile of ['/admin/leads', '/q/abc123', 'https://evil.test/x', '../../etc/passwd',
                         '', '/' + 'a'.repeat(500)]) {
    assert.equal(analytics.safePath(hostile, known), '/other', 'must be bucketed: ' + hostile.slice(0, 30));
  }
});

// ------------------------------------------------- the endpoint

test('the endpoint accepts the six events it knows and nothing else', async () => {
  const before = app.count('visit_events');

  for (const name of ['view', 'quote_cta', 'form_start', 'photos_added', 'call_click', 'text_click']) {
    const res = await event(name, '/junk-removal', { ip: '198.51.100.11' });
    assert.equal(res.status, 204, name + ' should be accepted');
  }
  assert.equal(app.count('visit_events') - before, 6, 'six rows for six events');

  const stored = rows(
    "select distinct name from visit_events where path = '/junk-removal' order by name"
  ).map((r) => r.name);
  assert.deepEqual(stored, ['call_click', 'form_start', 'photos_added', 'quote_cta', 'text_click', 'view']);
});

test('an event name we did not define is dropped, not stored', async () => {
  const before = app.count('visit_events');

  for (const name of ['evil', 'VIEW', 'view; drop table', '', 'a'.repeat(200), '__proto__']) {
    const res = await event(name, '/', { ip: '198.51.100.12' });
    // Always 204: this endpoint has no interface and tells a prober nothing.
    assert.equal(res.status, 204, 'the refusal must look identical to acceptance');
  }

  assert.equal(app.count('visit_events'), before, 'nothing unknown reached the table');
});

test('the browser cannot report the one event the owner acts on', async () => {
  const before = one("select count(*) as n from visit_events where name = 'quote_submit'").n;

  for (let i = 0; i < 3; i++) {
    assert.equal((await event('quote_submit', '/quote', { ip: '198.51.100.13' })).status, 204);
  }

  assert.equal(
    one("select count(*) as n from visit_events where name = 'quote_submit'").n,
    before,
    'quote_submit is a server event and must be unforgeable from a browser'
  );
});

test('a path the site does not have is bucketed rather than stored', async () => {
  await event('view', '/admin/dashboard', { ip: '198.51.100.14' });
  await event('view', '/q/some-private-token', { ip: '198.51.100.14' });

  // The private paths must not appear in the table in any form -- that is the
  // same rule the sitemap is held to, applied to the analytics table.
  assert.equal(one("select count(*) as n from visit_events where path like '/admin%'").n, 0);
  assert.equal(one("select count(*) as n from visit_events where path like '/q/%'").n, 0);
  assert.ok(one("select count(*) as n from visit_events where path = '/other'").n >= 2);
});

test('a crawler that runs scripts is still not a visitor', async () => {
  const before = app.count('visit_events');

  await event('view', '/', { ip: '198.51.100.15', ua: GOOGLEBOT });
  await event('view', '/', { ip: '198.51.100.15', ua: 'facebookexternalhit/1.1' });
  await event('view', '/', { ip: '198.51.100.15', ua: 'HeadlessChrome/120.0.0.0' });

  assert.equal(app.count('visit_events'), before, 'preview and headless fetchers are not people');
});

test('measuring sets no cookie and returns no body', async () => {
  const res = await app.post(
    '/api/event',
    { name: 'view', path: '/' },
    { ip: '198.51.100.16', headers: { 'user-agent': IPHONE } }
  );

  assert.equal(res.status, 204);
  assert.equal(await res.text(), '', 'nothing to read back');
  assert.deepEqual(res.headers.getSetCookie(), [], 'measurement must set no cookie of its own');
});

// ------------------------------------------------- what is stored

test('the tables hold no address, no user-agent and nothing personal', async () => {
  // Drive a full, realistic visit first so there is something to inspect.
  const ip = '198.51.100.20';
  await event('view', '/estate-cleanouts', { ip });
  await event('quote_cta', '/estate-cleanouts', { ip });
  await event('view', '/quote', { ip });
  await app.get('/junk-removal', { headers: { 'user-agent': GOOGLEBOT } });
  await settle();

  const everything = JSON.stringify([
    ...rows('select * from visit_events'),
    ...rows('select * from crawler_visits')
  ]);

  // The addresses the tests themselves presented, and the browser strings.
  for (const secret of [ip, '198.51.100', IPHONE, 'AppleWebKit', 'iPhone', SESSION_SECRET]) {
    assert.ok(!everything.includes(secret), 'must never be stored: ' + secret.slice(0, 24));
  }

  // The crawler is stored by name, not by the string it introduced itself with.
  const crawl = one("select * from crawler_visits where bot = 'googlebot' limit 1");
  assert.ok(crawl, 'the googlebot fetch should be recorded');
  assert.equal(crawl.bot, 'googlebot');
  assert.ok(!JSON.stringify(crawl).includes('Mozilla'), 'never the raw user-agent');

  // Columns, exhaustively. A column added later without thinking about this
  // test is the way personal data gets in here by accident.
  assert.deepEqual(
    Object.keys(rows('select * from visit_events limit 1')[0]).sort(),
    ['campaign', 'created_at', 'day', 'id', 'name', 'path', 'referrer', 'source', 'visitor']
  );
  assert.deepEqual(
    Object.keys(crawl).sort(),
    ['bot', 'created_at', 'day', 'id', 'path', 'status']
  );
});

// ------------------------------------------------- the page side

test('only the public pages carry a page name for the script', async () => {
  const measured = ['/', '/services', '/quote', '/service-area', '/privacy',
                    ...SERVICE_PAGES.map((p) => '/' + p.slug)];

  for (const path of measured) {
    const doc = await html(path);
    assert.match(
      doc,
      new RegExp('data-track="' + path.replace(/\//g, '\\/') + '"'),
      path + ' should name itself for the measurement script'
    );
  }

  // The admin and a customer's own page name nothing, so the script on them
  // exits before it sends anything at all.
  const lead = await (async () => {
    const res = await app.post('/quote', submission({ form_stamp: await freshStamp(app) }), {
      ip: '198.51.100.30'
    });
    assert.equal(res.status, 302);
    return app.read.prepare('select * from leads order by id desc limit 1').get();
  })();

  for (const [path, headers] of [
    ['/admin/dashboard', { cookie }],
    ['/admin/leads', { cookie }],
    ['/admin/traffic', { cookie }],
    ['/q/' + lead.public_token, {}]
  ]) {
    const doc = await html(path, headers);
    assert.ok(!doc.includes('data-track'), path + ' must not be measured');
  }
});

test('the submission at the bottom of the funnel is counted on the server', async () => {
  const before = one("select count(*) as n from visit_events where name = 'quote_submit'").n;

  const res = await app.post('/quote', submission({ form_stamp: await freshStamp(app) }), {
    ip: '198.51.100.31',
    headers: { 'user-agent': IPHONE }
  });
  assert.equal(res.status, 302);

  const after = one("select count(*) as n from visit_events where name = 'quote_submit'").n;
  assert.equal(after, before + 1, 'a real lead records exactly one submission event');

  const row = one("select * from visit_events where name = 'quote_submit' order by id desc limit 1");
  assert.equal(row.path, '/quote');
  assert.match(row.visitor, /^[0-9a-f]{16}$/);
  assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
});

test('a rejected submission records nothing', async () => {
  const before = one("select count(*) as n from visit_events where name = 'quote_submit'").n;
  const leadsNow = () => one('select count(*) as n from leads').n;
  const leadsBefore = leadsNow();

  // No form stamp: the bot filter refuses it and no lead is created.
  const res = await app.post('/quote', submission({ form_stamp: '' }), { ip: '198.51.100.32' });
  assert.notEqual(res.status, 302, 'a refused submission must not reach the confirmation');
  assert.equal(leadsNow(), leadsBefore, 'and must not create a lead');

  assert.equal(
    one("select count(*) as n from visit_events where name = 'quote_submit'").n,
    before,
    'the counter follows the lead row, not the attempt'
  );
});

test('a crawler fetch is recorded with the status it actually got', async () => {
  await app.get('/sitemap.xml', { headers: { 'user-agent': GOOGLEBOT } });
  await app.get('/robots.txt', { headers: { 'user-agent': 'Mozilla/5.0 (compatible; bingbot/2.0)' } });
  await app.get('/no-such-page-at-all', { headers: { 'user-agent': GOOGLEBOT } });
  await settle();

  const sitemap = one("select * from crawler_visits where path = '/sitemap.xml' order by id desc limit 1");
  assert.ok(sitemap, 'the sitemap fetch is the most useful one in the table');
  assert.equal(sitemap.status, 200);

  const robots = one("select * from crawler_visits where path = '/robots.txt' order by id desc limit 1");
  assert.ok(robots, 'robots.txt is served by express.static and must still be recorded');
  assert.equal(robots.bot, 'bingbot');

  // A 404 being crawled is exactly what the owner needs to see, so the status
  // recorded is the response, not the intent.
  const missing = one("select * from crawler_visits where path = '/no-such-page-at-all' limit 1");
  assert.ok(missing);
  assert.equal(missing.status, 404);
});

test('a person browsing is never recorded as a crawler', async () => {
  const before = app.count('crawler_visits');
  for (const path of ['/', '/junk-removal', '/quote']) {
    await app.get(path, { headers: { 'user-agent': IPHONE } });
  }
  await settle();
  assert.equal(app.count('crawler_visits'), before, 'a real browser is not a bot');
});

test('nothing private is ever recorded as a crawl', async () => {
  await app.get('/admin/dashboard', { headers: { cookie, 'user-agent': GOOGLEBOT } });
  await settle();
  assert.equal(one("select count(*) as n from crawler_visits where path like '/admin%'").n, 0);
  assert.equal(one("select count(*) as n from crawler_visits where path like '/q/%'").n, 0);
});

// ------------------------------------------------- the reporting

test('the traffic page is admin-only', async () => {
  const res = await app.get('/admin/traffic');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/admin\/login/);
});

test('the traffic page reports the funnel in people, and says what it is not', async () => {
  const doc = await html('/admin/traffic', { cookie });

  assert.match(doc, /Traffic &amp; funnel/);
  for (const step of ['Visitors', 'Clicked a quote button', 'Reached the quote form',
                      'Started filling it in', 'Sent a quote request']) {
    assert.ok(doc.includes(step), 'the funnel needs the step: ' + step);
  }

  // The paragraph that keeps a number from being read as something it is not.
  assert.match(doc, /evidence of crawling, not of indexing/i, 'the crawl/index distinction must be stated');
  assert.match(doc, /search\.google\.com\/search-console/, 'and must point at the thing that can answer it');

  // And the privacy summary, on the page where the figures are.
  assert.match(doc, /No cookie is set for any of this/i);
  assert.match(doc, /No IP address and no browser identification string is stored/i);

  // It is noindex like the rest of the admin.
  assert.match(doc, /<meta name="robots" content="noindex,nofollow">/);
});

test('a funnel step counts a person once, however many times they click', async () => {
  const fresh = await startServer({ BUSINESS_PHONE: PHONE });
  try {
    const ip = '198.51.100.40';
    // One person, five taps of the same button.
    for (let i = 0; i < 5; i++) {
      await fresh.post('/api/event', { name: 'quote_cta', path: '/' }, {
        ip,
        headers: { 'user-agent': IPHONE }
      });
    }
    await fresh.post('/api/event', { name: 'view', path: '/' }, {
      ip,
      headers: { 'user-agent': IPHONE }
    });

    const today = analytics.localDay();
    const events = fresh.read
      .prepare("select count(*) as n from visit_events where name = 'quote_cta'")
      .get().n;
    const people = fresh.read
      .prepare("select count(distinct visitor) as n from visit_events where name = 'quote_cta'")
      .get().n;

    assert.equal(events, 5, 'every click is stored');
    assert.equal(people, 1, 'and they are one person');

    const result = analytics.funnel(fresh.read, today, today);
    const clicked = result.steps.find((s) => s.key === 'quote_cta');
    assert.equal(clicked.people, 1, 'the funnel reports the person, not the five clicks');
  } finally {
    fresh.stop();
  }
});

test('a rate is only reported when there is something above it to divide by', () => {
  const empty = startServerless();
  const today = analytics.localDay();
  const result = analytics.funnel(empty, today, today);

  assert.equal(result.steps[0].rate, null, 'the top step has no step above it');
  for (const step of result.steps.slice(1)) {
    assert.equal(step.rate, null, 'no denominator means no percentage, never 0% or NaN');
  }
  assert.equal(result.contact.ofVisitors, null);

  /** An in-memory database with the analytics tables and nothing in them. */
  function startServerless() {
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(':memory:');
    const db = {
      exec: (sql) => raw.exec(sql),
      prepare: (sql) => {
        const stmt = raw.prepare(sql);
        return { get: (...a) => stmt.get(...a), all: (...a) => stmt.all(...a), run: (...a) => stmt.run(...a) };
      }
    };
    analytics.migrate(db);
    return db;
  }
});

test('the dashboard carries the headline and links to the detail', async () => {
  const doc = await html('/admin/dashboard', { cookie });

  assert.match(doc, /Website this month/);
  assert.match(doc, /href="\/admin\/traffic"/, 'the dashboard has to lead to the detail');
  // The figures the owner would read first.
  for (const label of ['Visitors', 'Quote buttons clicked', 'Forms started', 'Call / text taps']) {
    assert.ok(doc.includes(label), 'the dashboard needs: ' + label);
  }
});

test('the range tabs are real links, and a junk range falls back rather than failing', async () => {
  for (const range of ['7', '30', '90']) {
    const res = await app.get('/admin/traffic?range=' + range, { headers: { cookie } });
    assert.equal(res.status, 200, 'range ' + range);
    const doc = await res.text();
    assert.match(doc, new RegExp('href="/admin/traffic\\?range=' + range + '"[^>]*class="here"'));
  }

  for (const junk of ['', 'bogus', '9999', '-1', "1'; drop table visit_events; --"]) {
    const res = await app.get('/admin/traffic?range=' + encodeURIComponent(junk), { headers: { cookie } });
    assert.equal(res.status, 200, 'junk range must fall back, not fail: ' + junk);
    assert.match(await res.text(), /Last 30 days/, 'and fall back to the default');
  }

  // The table is still there afterwards.
  assert.ok(app.count('visit_events') >= 0);
});

// ------------------------------------------------- the script on the page

test('the page script talks only to this server, and honours Do Not Track', async () => {
  const js = await (await app.get('/app.js')).text();

  // One destination, ours, and no other network call anywhere in the file.
  assert.match(js, /sendBeacon\('\/api\/event'/, 'the only endpoint it posts to');
  for (const url of ['http://', 'https://']) {
    assert.ok(!js.includes(url), 'the script must contact nobody else: ' + url);
  }
  assert.ok(!/\bfetch\(/.test(js), 'no fetch, so nothing can be sent anywhere else');

  assert.match(js, /doNotTrack/, 'a browser asking not to be measured is obeyed');

  // It must not read or write any client-side store. The privacy policy says
  // no identifier is created; this is where that would quietly stop being
  // true.
  for (const store of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
    assert.ok(!js.includes(store), 'the script must not use ' + store);
  }

  // And it must send only the two fields the endpoint accepts.
  assert.match(js, /data\.set\('name'/);
  assert.match(js, /data\.set\('path'/);
  assert.equal((js.match(/data\.set\(/g) || []).length, 2, 'two fields, no more');
});

test('the measurement endpoint is rate limited', async () => {
  const fresh = await startServer({ BUSINESS_PHONE: PHONE });
  try {
    // One IP, far past any plausible browsing session.
    for (let i = 0; i < 60; i++) {
      await fresh.post('/api/event', { name: 'view', path: '/' }, {
        ip: '198.51.100.99',
        headers: { 'user-agent': IPHONE }
      });
    }
    const stored = fresh.read.prepare("select count(*) as n from visit_events where name = 'view'").get().n;
    assert.ok(stored < 60, 'the limiter has to bite before sixty');
    assert.ok(stored >= 20, 'and must not be so tight that real browsing hits it');
  } finally {
    fresh.stop();
  }
});

// ------------------------------------------------- retention

test('pruning removes old rows and leaves recent ones alone', () => {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(':memory:');
  const db = {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const stmt = raw.prepare(sql);
      return {
        get: (...a) => stmt.get(...a),
        all: (...a) => stmt.all(...a),
        run: (...a) => {
          const r = stmt.run(...a);
          return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
        }
      };
    }
  };
  analytics.migrate(db);

  for (const day of ['2026-01-01', '2026-01-02', '2026-06-01']) {
    analytics.record(db, { name: 'view', path: '/', visitor: 'abcdef0123456789', day });
    analytics.recordCrawl(db, { bot: 'googlebot', path: '/', status: 200, day });
  }

  const removed = analytics.prune(db, '2026-06-01');
  assert.equal(removed, 4, 'two views and two crawls from January');
  assert.equal(db.prepare('select count(*) as n from visit_events').get().n, 1);
  assert.equal(db.prepare('select count(*) as n from crawler_visits').get().n, 1);
});
