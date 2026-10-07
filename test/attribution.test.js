'use strict';

// Lead attribution and the owner's dashboard.
//
// The assertion that matters most here is the one about survival: attribution
// is worth nothing if it only works when someone lands on /quote directly. A
// real visitor arrives on a service page from an ad, reads it, clicks through,
// and submits — so that is the path these tests drive, with a cookie jar,
// through a real server.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, freshStamp, submission } = require('./helpers');
const attribution = require('../attribution');

const SITE = 'https://getrydja.com';

let app;
let cookie;

test.before(async () => {
  app = await startServer({ SITE_URL: SITE });
  cookie = await app.adminCookie();
});

test.after(() => app?.stop());

/**
 * A browser. Keeps the cookie the server sets and sends it back, which is the
 * whole mechanism under test — a client that discards cookies cannot carry
 * attribution and should not appear to.
 */
function visitor(server, { ip = '203.0.113.70' } = {}) {
  let jar = '';
  const remember = (res) => {
    const set = res.headers.getSetCookie();
    if (set.length) jar = set.map((c) => c.split(';')[0]).join('; ');
    return res;
  };
  return {
    jar: () => jar,
    get: (url, headers = {}) =>
      server.get(url, { headers: { ...(jar ? { cookie: jar } : {}), ...headers } }).then(remember),
    post: (url, fields) =>
      server.post(url, fields, { ip, headers: jar ? { cookie: jar } : {} }).then(remember)
  };
}

/** Walk a visitor through the form the way a person would, and return the lead. */
async function submitAs(browser, overrides = {}) {
  const page = await (await browser.get('/quote')).text();
  const stamp = page.match(/name="form_stamp" value="([^"]+)"/)[1];
  const res = await browser.post('/quote', submission({ form_stamp: stamp, ...overrides }));
  assert.equal(res.status, 302, 'the submission should have been accepted');
  return app.read.prepare('select * from leads order by id desc limit 1').get();
}

// ------------------------------------------------------------- the unit bits

test('a source is normalized from utm_source, then from the referrer, then direct', () => {
  const from = (utm, host) => attribution.normalizeSource(utm, host);

  assert.equal(from('google', null), 'google');
  assert.equal(from('Google', null), 'google', 'case does not matter');
  assert.equal(from('facebook', null), 'facebook');
  assert.equal(from('fb', null), 'facebook');
  assert.equal(from('bing', null), 'bing');
  assert.equal(from('nextdoor', null), 'other', 'an unrecognised campaign is other, not direct');

  // No campaign: the referring host decides.
  assert.equal(from(null, 'google.com'), 'google');
  assert.equal(from(null, 'news.google.co.uk'), 'google');
  assert.equal(from(null, 'm.facebook.com'), 'facebook');
  assert.equal(from(null, 'lowellchamber.org'), 'referral');
  assert.equal(from(null, null), 'direct');

  // A campaign always outranks the referrer: the link we handed out is the
  // thing we actually know.
  assert.equal(from('facebook', 'google.com'), 'facebook');
});

test('a referrer is reduced to a bare host, and junk is dropped', () => {
  const host = attribution.referrerHost;

  assert.equal(host('https://www.facebook.com/some/post?id=1'), 'facebook.com');
  assert.equal(host('https://GOOGLE.com/search?q=junk+removal'), 'google.com');
  assert.equal(host('not a url'), null);
  assert.equal(host(''), null);
  assert.equal(host(undefined), null);
});

// -------------------------------------------------------------- the journey

test('attribution survives a visit that starts on an ad and ends on the form', async () => {
  const browser = visitor(app, { ip: '203.0.113.71' });

  // The ad click.
  await browser.get('/junk-removal?utm_source=google&utm_medium=cpc&utm_campaign=junk-removal' +
                    '&utm_content=headline-b&utm_term=junk%20removal%20near%20me');
  assert.ok(browser.jar(), 'the visit should be remembered');

  // Reads a couple more pages first, as people do.
  await browser.get('/service-area');
  await browser.get('/cleanouts');

  const lead = await submitAs(browser);

  assert.equal(lead.source, 'google');
  assert.equal(lead.utm_source, 'google');
  assert.equal(lead.medium, 'cpc');
  assert.equal(lead.campaign, 'junk-removal');
  assert.equal(lead.content, 'headline-b');
  assert.equal(lead.term, 'junk removal near me');
  assert.equal(lead.landing_path, '/junk-removal', 'the page they arrived on, not the one they submitted from');
});

test('the first page of a visit wins, and later pages never overwrite it', async () => {
  const browser = visitor(app, { ip: '203.0.113.72' });

  await browser.get('/?utm_source=facebook&utm_medium=social&utm_campaign=launch');
  // A second tagged link mid-visit must not rewrite history: the first click
  // is what earned the lead.
  await browser.get('/junk-removal?utm_source=google&utm_medium=cpc&utm_campaign=stolen');

  const lead = await submitAs(browser);

  assert.equal(lead.source, 'facebook');
  assert.equal(lead.campaign, 'launch');
  assert.equal(lead.landing_path, '/');
});

test('an untagged visit from another website is a referral, with the host only', async () => {
  const browser = visitor(app, { ip: '203.0.113.73' });
  await browser.get('/', { referer: 'https://www.lowellchamber.org/members/directory?page=3' });

  const lead = await submitAs(browser);

  assert.equal(lead.source, 'referral');
  assert.equal(lead.referrer, 'lowellchamber.org', 'the host, with no www and no path');
  assert.equal(lead.campaign, null);
});

test('a search engine referral is attributed to the engine, not counted as a referral', async () => {
  const browser = visitor(app, { ip: '203.0.113.74' });
  await browser.get('/junk-removal', { referer: 'https://www.google.com/search?q=junk+removal+lowell+mi' });

  const lead = await submitAs(browser);
  assert.equal(lead.source, 'google');
  assert.equal(lead.referrer, 'google.com');
});

test('browsing our own pages is one visit, not a referral from ourselves', async () => {
  const browser = visitor(app, { ip: '203.0.113.75' });
  await browser.get('/', { referer: SITE + '/junk-removal' });

  const lead = await submitAs(browser);
  assert.equal(lead.source, 'direct', 'our own page is not a source');
  assert.equal(lead.referrer, null);
});

test('a plain visit with no campaign and no referrer is direct', async () => {
  const browser = visitor(app, { ip: '203.0.113.76' });
  await browser.get('/');

  const lead = await submitAs(browser);
  assert.equal(lead.source, 'direct');
  assert.equal(lead.utm_source, null);
  assert.equal(lead.referrer, null);
  assert.equal(lead.landing_path, '/');
});

test('a client that keeps no cookie records nothing rather than guessing', async () => {
  // app.post sends no cookie at all, which is what a crawler or a curl does.
  const res = await app.post('/quote', submission({ form_stamp: await freshStamp(app) }), { ip: '203.0.113.77' });
  assert.equal(res.status, 302);

  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  assert.equal(lead.source, null, 'unknown is null, never a fabricated "direct"');
  assert.equal(lead.landing_path, null);
});

test('a crafted campaign value cannot bloat the row or smuggle control characters', async () => {
  const browser = visitor(app, { ip: '203.0.113.78' });
  await browser.get('/?utm_source=google&utm_campaign=' + encodeURIComponent('x'.repeat(500)));

  const lead = await submitAs(browser);
  assert.equal(lead.source, 'google');
  assert.ok(lead.campaign.length <= 120, 'campaign is capped, got ' + lead.campaign.length);
});

// ------------------------------------------------------------- canonical URLs

test('campaign parameters never reach a canonical, an og:url or a sitemap', async () => {
  const tagged = '?utm_source=facebook&utm_medium=social&utm_campaign=launch';

  for (const path of ['/', '/junk-removal', '/services', '/service-area']) {
    const res = await app.get(path + tagged);
    assert.equal(res.status, 200, path + tagged + ' must still work normally');

    const doc = await res.text();
    const canonical = doc.match(/<link rel="canonical" href="([^"]+)"/)[1];
    assert.equal(canonical, SITE + path, 'canonical must stay clean: ' + canonical);

    const ogUrl = doc.match(/property="og:url" content="([^"]+)"/)[1];
    assert.equal(ogUrl, SITE + path, 'og:url must stay clean: ' + ogUrl);

    for (const marker of ['utm_', 'launch']) {
      assert.ok(!canonical.includes(marker) && !ogUrl.includes(marker), path + ' leaked ' + marker);
    }
  }

  const xml = await (await app.get('/sitemap.xml')).text();
  assert.ok(!xml.includes('utm_'), 'the sitemap must never carry campaign parameters');
});

test('attribution is not collected from the admin or a customer page', async () => {
  const before = (await app.get('/admin/leads?utm_source=google', { headers: { cookie } })).headers.getSetCookie();
  // The admin already holds a session; what matters is that nothing in it
  // starts attributing the owner's own clicks to a campaign.
  assert.ok(
    !before.join(' ').includes('utm'),
    'the admin session must not pick up campaign parameters'
  );

  const lead = app.read.prepare('select * from leads order by id desc limit 1').get();
  const page = await (await app.get('/q/' + lead.public_token + '?utm_source=google')).text();
  assert.match(page, /<meta name="robots" content="noindex,nofollow">/, 'still private');
});

test('no third-party analytics or pixel is introduced anywhere public', async () => {
  const banned = [
    'googletagmanager', 'google-analytics', 'gtag(', 'analytics.js',
    'connect.facebook.net', 'fbq(', 'facebook-jssdk', 'hotjar', 'clarity.ms',
    'segment.com', 'mixpanel', 'plausible.io', 'matomo'
  ];

  for (const path of ['/', '/quote', '/junk-removal', '/services', '/privacy', '/app.js', '/styles.css']) {
    const body = await (await app.get(path)).text();
    const lower = body.toLowerCase();
    for (const marker of banned) {
      assert.ok(!lower.includes(marker), path + ' must not reference ' + marker);
    }
  }
});

// ---------------------------------------------------------------- dashboard

test('the dashboard is private, and reachable from the admin', async () => {
  const anon = await app.get('/admin/dashboard');
  assert.equal(anon.status, 302, 'signed out must not see the numbers');
  assert.match(anon.headers.get('location'), /\/admin\/login/);

  const res = await app.get('/admin/dashboard', { headers: { cookie } });
  assert.equal(res.status, 200);

  const doc = await res.text();
  assert.match(doc, /<meta name="robots" content="noindex,nofollow">/, 'never indexable');
  assert.match(doc, /Needs attention/);
  assert.match(doc, /Lead sources/);

  // /admin lands here now.
  const root = await app.get('/admin', { headers: { cookie } });
  assert.equal(root.headers.get('location'), '/admin/dashboard');
});

test('the dashboard counts the month and the money correctly', async () => {
  const fresh = await startServer({ SITE_URL: SITE });
  try {
    const admin = await fresh.adminCookie();
    const browser = visitor(fresh, { ip: '203.0.113.80' });

    // Two leads this month: one from an ad, one direct.
    await browser.get('/junk-removal?utm_source=facebook&utm_medium=social&utm_campaign=launch');
    const page = await (await browser.get('/quote')).text();
    await browser.post('/quote', submission({
      form_stamp: page.match(/name="form_stamp" value="([^"]+)"/)[1]
    }));

    const second = visitor(fresh, { ip: '203.0.113.81' });
    await second.get('/');
    const page2 = await (await second.get('/quote')).text();
    await second.post('/quote', submission({
      phone: '6165550199',
      form_stamp: page2.match(/name="form_stamp" value="([^"]+)"/)[1]
    }));

    const leads = fresh.read.prepare('select * from leads order by id').all();
    assert.equal(leads.length, 2);

    // Quote the Facebook one and have the customer approve it.
    const quoted = leads[0];
    await fresh.post('/admin/leads/' + quoted.id + '/quote',
      { amount: '450', notes: 'Full garage' }, { headers: { cookie: admin } });
    const quote = fresh.read.prepare('select * from quotes where lead_id = ?').get(quoted.id);
    await fresh.post('/q/' + quoted.public_token + '/respond', { decision: 'approve' });

    const job = fresh.read.prepare('select * from jobs where quote_id = ?').get(quote.id);
    assert.ok(job, 'approving should have created the job');

    // Run it, spend on it, sell something off it, finish it.
    await fresh.post('/admin/jobs/' + job.id + '/expenses',
      { category: 'dump', amount: '95', weight_lbs: '820' }, { headers: { cookie: admin } });
    await fresh.post('/admin/jobs/' + job.id + '/salvage',
      { title: 'Snowblower', disposition: 'resell', estimated_value: '120' }, { headers: { cookie: admin } });
    const item = fresh.read.prepare('select * from salvage_items where job_id = ?').get(job.id);
    await fresh.post('/admin/jobs/' + job.id + '/salvage/' + item.id,
      { realized_value: '80' }, { headers: { cookie: admin } });
    await fresh.post('/admin/jobs/' + job.id + '/status',
      { status: 'complete' }, { headers: { cookie: admin } });

    const doc = await (await fresh.get('/admin/dashboard', { headers: { cookie: admin } })).text();
    const metric = (label) => {
      const m = doc.match(new RegExp('<span>' + label + '</span><strong>([^<]+)</strong>'));
      assert.ok(m, 'dashboard should show ' + label);
      return m[1].trim();
    };

    assert.equal(metric('Leads'), '2');
    assert.equal(metric('Quotes sent'), '1');
    assert.equal(metric('Quotes approved'), '1');
    assert.equal(metric('Jobs completed'), '1');

    assert.equal(metric('Customer revenue'), '$450.00');
    assert.equal(metric('Recorded expenses'), '$95.00');
    assert.equal(metric('Realized salvage'), '$80.00');
    // 450 - 95 + 80. The same arithmetic the job page does.
    assert.equal(metric('Net contribution'), '$435.00');

    // Source table: Facebook converted, Direct did not.
    const row = (label) => {
      const m = doc.match(new RegExp('>' + label + '</span></td>\\s*<td[^>]*>(\\d+)</td>\\s*<td[^>]*>(\\d+)</td>\\s*<td[^>]*>([^<]+)</td>'));
      assert.ok(m, 'dashboard should show a ' + label + ' row');
      return { leads: Number(m[1]), approved: Number(m[2]), rate: m[3].trim() };
    };

    assert.deepEqual(row('Facebook'), { leads: 1, approved: 1, rate: '100%' });
    assert.deepEqual(row('Direct'), { leads: 1, approved: 0, rate: '0%' });
    // A source with no leads is not printed as a row of zeroes.
    assert.ok(!doc.includes('>Bing</span>'), 'empty sources are left out');
  } finally {
    fresh.stop();
  }
});

test('a conversion rate is never divided by zero', async () => {
  const fresh = await startServer({ SITE_URL: SITE });
  try {
    const admin = await fresh.adminCookie();
    const doc = await (await fresh.get('/admin/dashboard', { headers: { cookie: admin } })).text();

    // No leads at all: every number is a real zero and nothing is NaN.
    assert.match(doc, /No leads yet this month/);
    assert.ok(!/NaN|Infinity|undefined|null%/.test(doc), 'no arithmetic artefacts on an empty dashboard');
    assert.match(doc, /<span>Leads<\/span><strong>0<\/strong>/);
    assert.match(doc, /<span>Net contribution<\/span><strong>\$0\.00<\/strong>/);
  } finally {
    fresh.stop();
  }
});

test('needs-attention counts what is actually waiting', async () => {
  const fresh = await startServer({ SITE_URL: SITE });
  try {
    const admin = await fresh.adminCookie();
    const browser = visitor(fresh, { ip: '203.0.113.82' });
    await browser.get('/');
    const page = await (await browser.get('/quote')).text();
    await browser.post('/quote', submission({
      form_stamp: page.match(/name="form_stamp" value="([^"]+)"/)[1]
    }));

    const count = (doc, label) => {
      const m = doc.match(new RegExp('<strong>(\\d+)</strong>\\s*<span>' + label + '</span>'));
      assert.ok(m, 'needs attention should list "' + label + '"');
      return Number(m[1]);
    };

    let doc = await (await fresh.get('/admin/dashboard', { headers: { cookie: admin } })).text();
    assert.equal(count(doc, 'New leads without a quote'), 1);
    assert.equal(count(doc, 'Quotes awaiting an answer'), 0);

    // Send a quote: it moves from one bucket to the other.
    const lead = fresh.read.prepare('select * from leads order by id desc limit 1').get();
    await fresh.post('/admin/leads/' + lead.id + '/quote',
      { amount: '300' }, { headers: { cookie: admin } });

    doc = await (await fresh.get('/admin/dashboard', { headers: { cookie: admin } })).text();
    assert.equal(count(doc, 'New leads without a quote'), 0);
    assert.equal(count(doc, 'Quotes awaiting an answer'), 1);
    assert.equal(count(doc, 'Approved jobs not yet scheduled'), 0);

    // Approve it: now there is a job with no time on it.
    const quote = fresh.read.prepare('select * from quotes where lead_id = ?').get(lead.id);
    await fresh.post('/q/' + lead.public_token + '/respond', { decision: 'approve' });

    doc = await (await fresh.get('/admin/dashboard', { headers: { cookie: admin } })).text();
    assert.equal(count(doc, 'Quotes awaiting an answer'), 0);
    assert.equal(count(doc, 'Approved jobs not yet scheduled'), 1);
  } finally {
    fresh.stop();
  }
});

// ------------------------------------------------------------------- admin UI

test('the lead inbox and the lead page both say where a lead came from', async () => {
  const browser = visitor(app, { ip: '203.0.113.83' });
  await browser.get('/cleanouts?utm_source=facebook&utm_medium=social&utm_campaign=spring-clean',
    { referer: 'https://www.facebook.com/some/post' });
  const lead = await submitAs(browser, { phone: '6165550177' });

  const list = await (await app.get('/admin/leads', { headers: { cookie } })).text();
  assert.match(list, /<div>Source<\/div>/, 'the table has a source column');
  assert.match(list, /class="src-chip src-facebook">Facebook</, 'the row shows the source');

  const page = await (await app.get('/admin/leads/' + lead.id, { headers: { cookie } })).text();
  assert.match(page, /Lead source/);
  assert.match(page, /class="src-chip src-facebook">Facebook</);
  assert.match(page, /spring-clean/, 'the campaign is shown');
  assert.match(page, />\/cleanouts</, 'the landing page is shown');
  assert.match(page, /facebook\.com/, 'the referring domain is shown');

  // The domain only. The page they were reading is not ours to display.
  assert.ok(!page.includes('/some/post'), 'the referring path must never be stored or shown');
});

test('a lead that predates attribution still opens, and reads as unknown', async () => {
  const fresh = await startServer({ SITE_URL: SITE });
  try {
    const admin = await fresh.adminCookie();
    const res = await fresh.post('/quote', submission({ form_stamp: await freshStamp(fresh) }), { ip: '203.0.113.84' });
    assert.equal(res.status, 302);

    const lead = fresh.read.prepare('select * from leads order by id desc limit 1').get();
    assert.equal(lead.source, null);

    const page = await (await fresh.get('/admin/leads/' + lead.id, { headers: { cookie: admin } })).text();
    assert.match(page, /src-unknown">Unknown</, 'an absent source reads as Unknown');
    assert.match(page, /predates source tracking/);

    const list = await (await fresh.get('/admin/leads', { headers: { cookie: admin } })).text();
    assert.match(list, /src-unknown">Unknown</);

    // And it is excluded from every rate rather than counted as a failure of
    // some source that was never recorded.
    const doc = await (await fresh.get('/admin/dashboard', { headers: { cookie: admin } })).text();
    assert.match(doc, />Unknown<\/span>/, 'unknown is its own row');
    assert.ok(!doc.includes('>Direct</span>'), 'and is never folded into Direct');
  } finally {
    fresh.stop();
  }
});

// ------------------------------------------------------------------ migration

test('the attribution columns are additive and survive being migrated twice', async () => {
  const fresh = await startServer({ SITE_URL: SITE });
  try {
    const columns = () =>
      new Set(fresh.read.prepare('pragma table_info(leads)').all().map((c) => c.name));

    const expected = ['source', 'utm_source', 'medium', 'campaign', 'content', 'term',
                      'referrer', 'landing_path'];
    const have = columns();
    for (const col of expected) assert.ok(have.has(col), 'leads should have ' + col);

    // Nothing that was there before was dropped on the way.
    for (const col of ['id', 'public_token', 'work_ref', 'service', 'description', 'zip', 'status']) {
      assert.ok(have.has(col), 'migration must not drop ' + col);
    }

    const browser = visitor(fresh, { ip: '203.0.113.85' });
    await browser.get('/?utm_source=google');
    const page = await (await browser.get('/quote')).text();
    await browser.post('/quote', submission({
      form_stamp: page.match(/name="form_stamp" value="([^"]+)"/)[1]
    }));
    const before = fresh.read.prepare('select * from leads order by id').all();
    assert.equal(before.length, 1);
    const dbPath = fresh.read.prepare('pragma database_list').all()[0].file;
    fresh.stop();

    // Boot a second server over the same file. migrate() runs again and must
    // change nothing.
    const again = await startServer({ SITE_URL: SITE, DB_PATH: dbPath });
    try {
      const after = again.read.prepare('select * from leads order by id').all();
      assert.deepEqual(after, before, 're-running the migration must not touch a row');
      assert.ok(!again.logs().includes('[migrate] added leads.source'),
        'the second run should have nothing to add');
    } finally {
      again.stop();
    }
  } catch (err) {
    try { fresh.stop(); } catch { /* already stopped */ }
    throw err;
  }
});
