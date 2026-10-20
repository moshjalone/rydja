'use strict';

// Getting between admin sections on a phone.
//
// The defect: the header's <nav> is `display:none` below 860px. For the
// public links that is fine -- they have a footer and a homepage to live in.
// For the admin it was a dead end. Every admin section exists ONLY in that
// hidden nav, so the only way from the lead inbox to the job board on a phone
// was editing the address bar.
//
// The acceptance test is the plain one: signed in, from each admin section in
// SECTIONS, every other section is one tap away. Everything else in
// here guards the ways that could be true and still wrong -- a public visitor
// seeing operator links, a customer's own page sprouting an admin bar, or the
// thing being hidden behind JavaScript on the one device least likely to run
// it well.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, freshStamp, submission } = require('./helpers');

const SITE = 'https://getrydja.com';
const SECTIONS = ['/admin/dashboard', '/admin/leads', '/admin/jobs', '/admin/traffic', '/admin/partners',
                  '/admin/opportunities'];

let app;
let cookie;
let lead;

test.before(async () => {
  app = await startServer({ SITE_URL: SITE, BUSINESS_PHONE: '1-616-929-3360' });
  cookie = await app.adminCookie();
  const res = await app.post('/quote', submission({ form_stamp: await freshStamp(app) }), { ip: '203.0.113.70' });
  assert.equal(res.status, 302);
  lead = app.read.prepare('select * from leads order by id desc limit 1').get();
});

test.after(() => app?.stop());

const html = async (url, headers) => (await app.get(url, { headers })).text();
const asAdmin = (url) => html(url, { cookie });

/** The admin nav element on a page, or '' if there is not one. */
function navOf(doc) {
  const open = doc.indexOf('<nav class="admin-nav"');
  if (open === -1) return '';
  return doc.slice(open, doc.indexOf('</nav>', open) + 6);
}

const linksIn = (nav) => [...nav.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);

// ------------------------------------------------- the acceptance test

test('from every admin section, every other section is one tap away', async () => {
  for (const from of SECTIONS) {
    const nav = navOf(await asAdmin(from));
    assert.ok(nav, from + ' has no mobile admin nav');

    for (const to of SECTIONS) {
      assert.ok(nav.includes('href="' + to + '"'), from + ' cannot reach ' + to);
    }
    assert.deepEqual(linksIn(nav), SECTIONS, from + ' nav links, in order');
  }
});

test('it reaches the deeper admin pages too, not just the section roots', async () => {
  const deeper = [
    '/admin',
    '/admin/leads/' + lead.id,
    '/admin/leads/' + lead.id + '/edit'
  ];

  for (const path of deeper) {
    const res = await app.get(path, { headers: { cookie } });
    // /admin redirects to the dashboard; follow it rather than asserting on a
    // 302 body.
    const doc = res.status === 302 ? await asAdmin(res.headers.get('location')) : await res.text();
    const nav = navOf(doc);
    assert.ok(nav, path + ' should carry the admin nav');
    assert.deepEqual(linksIn(nav), SECTIONS, path);
  }
});

test('the current section is marked, for the eye and for a screen reader', async () => {
  for (const here of SECTIONS) {
    const nav = navOf(await asAdmin(here));

    const current = [...nav.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g)].map((m) => m[1]);
    assert.deepEqual(current, [here], here + ' should mark exactly itself as current');
    assert.match(nav, new RegExp('href="' + here + '" class="here"'), here + ' needs the class too');
  }

  // A detail page is still its section: /admin/leads/7 marks Leads.
  const deep = navOf(await asAdmin('/admin/leads/' + lead.id));
  const current = [...deep.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g)].map((m) => m[1]);
  assert.deepEqual(current, ['/admin/leads'], 'a lead detail page is still the Leads section');

  // Colour is not the only signal: the marked link carries a class the
  // stylesheet gives an underline, not just a different shade.
  const css = await (await app.get('/styles.css')).text();
  assert.match(css, /\.admin-nav a\.here\{[^}]*border-bottom-color:/, 'current needs a non-colour cue');
});

// ------------------------------------------------- who must never see it

test('a public visitor never sees operator links', async () => {
  for (const path of ['/', '/services', '/quote', '/junk-removal', '/service-area', '/admin/login']) {
    const doc = await html(path);
    assert.equal(navOf(doc), '', path + ' must not carry the admin nav');
    for (const section of SECTIONS) {
      assert.ok(!doc.includes('href="' + section + '"'), path + ' must not link ' + section);
    }
  }
});

test('a customer reading their own page never sees it, even while we are signed in', async () => {
  // The case that makes "isAdmin alone" the wrong condition: Josh opens a
  // customer's private link in his own browser. The page is the customer's,
  // and an operator bar does not belong over the top of it.
  const own = await asAdmin('/q/' + lead.public_token);
  assert.equal(navOf(own), '', "a customer's own page must stay a customer's page");

  const theirs = await html('/q/' + lead.public_token);
  assert.equal(navOf(theirs), '');
});

test('signed in on the public site, the nav stays off but the way in remains', async () => {
  const home = await asAdmin('/');
  assert.equal(navOf(home), '', 'the public homepage is not an admin screen');
  // The footer already carries the way back in, so this is not a dead end.
  assert.match(home, /href="\/admin\/leads">Admin</, 'the footer admin link must remain');
});

test('signing out removes it immediately', async () => {
  const out = await app.post('/admin/logout', {}, { headers: { cookie }, ip: '203.0.113.71' });
  const ended = out.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

  const doc = await html('/admin/login', { cookie: ended });
  assert.equal(navOf(doc), '');

  // And the admin itself is no longer reachable with that cookie.
  const res = await app.get('/admin/leads', { headers: { cookie: ended } });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/admin\/login/);
});

// ------------------------------------------------- how it is built

test('it is real HTML that works with scripting off', async () => {
  const nav = navOf(await asAdmin('/admin/leads'));

  assert.doesNotMatch(nav, /onclick|data-|<button|<script/, 'plain links only');
  assert.match(nav, /aria-label="Admin sections"/);
  // One anchor per section, each with a real href. Nothing is a span waiting
  // for JS, and the count is derived so adding a fifth section does not mean
  // editing this line as well as the template.
  assert.equal((nav.match(/<a /g) || []).length, SECTIONS.length);
  assert.equal((nav.match(/href="\/admin\//g) || []).length, SECTIONS.length);

  // app.js knows nothing about it.
  const js = await (await app.get('/app.js')).text();
  assert.ok(!js.includes('admin-nav'), 'the nav must not depend on the script');
});

test('it exists only where the header nav is hidden, and is tappable there', async () => {
  const css = await (await app.get('/styles.css')).text();

  // Hidden by default; only the mobile breakpoint turns it on. On desktop the
  // header nav already carries these links and a second row would be clutter.
  assert.match(css, /\.admin-nav\{display:none\}/, 'hidden above the breakpoint');

  const at = css.indexOf('.admin-nav{display:none}');
  const mobile = css.slice(css.indexOf('@media(max-width:860px){', at));
  assert.match(mobile, /\.admin-nav\{[^}]*display:grid/, 'shown at the mobile breakpoint');
  assert.match(mobile, /\.admin-nav a\{[^}]*min-height:5\dpx/, 'touch targets must clear 44px');
  assert.match(mobile, /\.admin-nav a:focus-visible\{/, 'keyboard focus must be visible');

  // The same breakpoint that hides the header nav is the one that shows this.
  assert.match(css, /@media\(max-width:860px\)\{[\s\S]*?\.nav>nav\{display:none\}/);
});

test('it does not fight the other fixed furniture on a phone', async () => {
  const css = await (await app.get('/styles.css')).text();

  // Not fixed and not sticky: the header above it already is, and the lead
  // and job lists carry a sticky bulk bar at the bottom. A third floating
  // strip on a 390px screen is how content becomes unreachable.
  const block = css.slice(css.indexOf('.admin-nav{display:none}'));
  const rule = block.slice(block.indexOf('.admin-nav{', 30), block.indexOf('}', block.indexOf('.admin-nav{', 30)));
  assert.ok(!/position:(fixed|sticky)/.test(rule), 'the admin nav must not float: ' + rule);

  // And the customer conversion bar is never on an admin page to collide with.
  for (const path of SECTIONS) {
    const doc = await asAdmin(path);
    assert.ok(!doc.includes('class="mobile-cta"'), path + ' must not carry the customer CTA bar');
    assert.ok(!doc.includes('has-mobile-cta'), path + ' must not reserve space for it');
  }
});

test('the admin list pages still work around it', async () => {
  // The toolbar and the rows all still render beneath the nav.
  for (const path of ['/admin/leads', '/admin/jobs']) {
    const doc = await asAdmin(path);
    assert.ok(navOf(doc), path + ' nav');
    assert.match(doc, /class="toolbar"/, path + ' keeps its search and filters');
    // The nav comes before the content, not inside it.
    assert.ok(doc.indexOf('admin-nav') < doc.indexOf('<main'), path + ' nav should precede the content');
  }

  // The bulk bar only exists once there are rows to select, so it is checked
  // on the list that has one. This fixture has a lead and no jobs.
  const leads = await asAdmin('/admin/leads');
  assert.match(leads, /data-bulk-bar/, 'the lead list keeps its bulk bar');
  assert.ok(leads.indexOf('admin-nav') < leads.indexOf('data-bulk-bar'),
    'the nav is above the list, the bulk bar below it');
});

test('the desktop header nav is untouched', async () => {
  const doc = await asAdmin('/admin/dashboard');
  const header = doc.slice(doc.indexOf('<header class="nav">'), doc.indexOf('</header>'));

  for (const section of SECTIONS) {
    assert.ok(header.includes('href="' + section + '"'), 'the header should still carry ' + section);
  }
  assert.ok(header.includes('href="/services"'), 'and the public links');
  assert.ok(header.includes('Get a Quote'));
});

// ------------------------------------------------- no sideways scrolling

test('no admin control is wider than the narrow phone it has to fit', async () => {
  // Found on production at 430px: the service filter is a <select>, a
  // <select> is as wide as its longest option, and "Estate / whole-property
  // cleanout" made it 247px. As a flex item with no min-width:0 it could not
  // shrink, so the lead list scrolled sideways on a phone.
  const css = await (await app.get('/styles.css')).text();
  const mobile = css.slice(css.indexOf('@media(max-width:860px){'));

  assert.match(mobile, /\.toolbar-filters select\{[^}]*min-width:0/,
    'the filter selects must be allowed to shrink below their longest option');

  // And the desktop cap is still there, so this did not simply remove the
  // thing that kept the control a sane size on a wide screen.
  assert.match(css, /\.toolbar-filters select\{[^}]*max-width:230px/);
});

test('the longest filter option is still offered, just not at full width', async () => {
  // The fix must not have been "shorten the option text".
  const doc = await asAdmin('/admin/leads');
  assert.ok(doc.includes('Estate / whole-property cleanout'), 'the long option is still there');
  assert.match(doc, /<select name="service"/);
});
