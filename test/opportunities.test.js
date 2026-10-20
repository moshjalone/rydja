'use strict';

// Publicly advertised work, and the rules about where it may come from.
//
// Three things are load-bearing here.
//
// The source refusal. A restricted source is not a validation nicety — it is
// the line between a lead source RYDJA owns and a bought list that costs the
// reputation this whole effort is building. It is enforced on create AND on
// edit, because a refusal that is one edit away from pointless is not a
// refusal.
//
// The money chain. An opportunity is only worth tracking if it can be traced
// to a completed job, and the three figures involved — our estimate, the
// quote, the revenue — have to stay distinct. A dashboard that counts an
// approved quote as revenue flatters every number built on it.
//
// That nothing is fetched. No code path in this feature makes an outbound
// request to any source, and the test asserts the absence rather than
// trusting it.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, freshStamp, submission } = require('./helpers');

const opportunities = require('../opportunities');
const partners = require('../partners');

const PHONE = '1-616-929-3360';

let app;
let cookie;

test.before(async () => {
  app = await startServer({ BUSINESS_PHONE: PHONE, OWNER_NAME: 'Joshua Malone' });
  cookie = await app.adminCookie();
});

test.after(() => app?.stop());

const adminOpts = () => ({ headers: { cookie }, ip: '203.0.113.99' });
const one = (sql, ...args) => app.read.prepare(sql).get(...args);
const html = async (url, headers) => (await app.get(url, { headers })).text();

/** Record a find through the form, and return the row. */
async function record(fields = {}) {
  const res = await app.post(
    '/admin/opportunities',
    {
      title: 'Estate sale ending Sunday, Vergennes Twp',
      kind: 'estate',
      source_kind: 'estate_sale_listing',
      city: 'Lowell',
      ...fields
    },
    adminOpts()
  );
  assert.equal(res.status, 302, 'recording should redirect');
  const location = res.headers.get('location');
  if (!/\/admin\/opportunities\/\d+$/.test(location)) return { refused: true, location };
  return one('select * from opportunities where id = ?', Number(location.split('/').pop()));
}

/** A real lead, through the real form, so the money chain is real. */
async function newLead(overrides = {}) {
  const res = await app.post(
    '/quote',
    submission({ form_stamp: await freshStamp(app), ...overrides }),
    { ip: '198.51.100.' + (10 + Math.floor(Math.random() * 200)) }
  );
  assert.equal(res.status, 302);
  return one('select * from leads order by id desc limit 1');
}

// ------------------------------------------------- the source rules

test('every source declares a posture, and the postures mean what they say', () => {
  assert.ok(opportunities.SOURCES.length >= 10, 'the catalogue should be worth reading');

  for (const s of opportunities.SOURCES) {
    assert.ok(s.value && s.label, 'every source is named');
    assert.ok([opportunities.AUTHORIZED, opportunities.MANUAL_ONLY, opportunities.RESTRICTED].includes(s.posture),
      s.value + ' needs a real posture');
    // The three fields that make the catalogue an operating manual rather than
    // a dropdown: where to look, what you are looking for, and the rule.
    assert.ok(s.where && s.where.length > 10, s.value + ' must say where to look');
    assert.ok(s.what && s.what.length > 30, s.value + ' must say what it is good for');
    assert.ok(s.rule && s.rule.length > 30, s.value + ' must carry its rule');
  }

  // Exactly one restricted source, and it is the one that matters.
  const restricted = opportunities.SOURCES.filter((s) => s.posture === opportunities.RESTRICTED);
  assert.equal(restricted.length, 1);
  assert.equal(restricted[0].value, 'purchased_list');
  assert.match(restricted[0].rule, /NOT USED/);
});

test('the probate source carries the rule that makes it safe to use at all', () => {
  const probate = opportunities.SOURCES.find((s) => s.value === 'probate');
  assert.ok(probate);

  // A court docket is a public record and not a mailing list. This rule is the
  // difference between a business local professionals refer to and one
  // everybody warns each other about.
  assert.match(probate.rule, /NOT A MAILING LIST/i);
  assert.match(probate.rule, /bereaved family/i);
  assert.match(probate.rule, /attorney/i);
  assert.match(probate.rule, /Do not record\s+the decedent/i);
});

test('a restricted source is refused on create, and nothing is stored', async () => {
  const before = app.count('opportunities');

  const out = await record({ title: 'Lead bought from a marketplace', source_kind: 'purchased_list' });
  assert.ok(out.refused, 'it must not create a row');
  assert.match(out.location, /refused=1/, 'and must say why on the page');

  assert.equal(app.count('opportunities'), before, 'nothing reached the table');
});

test('an unknown source is refused the same way', async () => {
  const before = app.count('opportunities');
  for (const bad of ['', 'whatever', 'scraped', '__proto__', 'PURCHASED_LIST']) {
    const out = await record({ title: 'From ' + bad, source_kind: bad });
    assert.ok(out.refused, 'must be refused: ' + bad);
  }
  assert.equal(app.count('opportunities'), before);
});

test('a restricted source cannot be reached by editing either', async () => {
  const opp = await record({ title: 'Legitimately found', source_kind: 'bid_board' });

  const res = await app.post(
    '/admin/opportunities/' + opp.id + '/edit',
    { title: opp.title, source_kind: 'purchased_list' },
    adminOpts()
  );
  assert.equal(res.status, 302);

  assert.equal(
    one('select source_kind from opportunities where id = ?', opp.id).source_kind,
    'bid_board',
    'the edit must keep the source it had rather than accept a restricted one'
  );
});

test('a usable source is one that exists and is not restricted', () => {
  assert.equal(opportunities.usableSource('bid_board'), true);
  assert.equal(opportunities.usableSource('marketplace'), true, 'manual-only is still usable by a person');
  assert.equal(opportunities.usableSource('purchased_list'), false);
  for (const junk of ['', null, undefined, 'nope', 42]) {
    assert.equal(opportunities.usableSource(junk), false, String(junk));
  }
});

// ------------------------------------------------- nothing is fetched

test('no code path in this feature makes an outbound request', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'opportunities.js'), 'utf8');

  // The whole posture of the feature. A fetch here would turn a documented
  // "read it by hand" rule into a scraper.
  for (const call of ['fetch(', 'http.get', 'https.get', 'request(', 'axios',
                      'node-fetch', 'puppeteer', 'playwright', 'cheerio', 'jsdom']) {
    assert.ok(!src.includes(call), 'opportunities.js must not reach the network: ' + call);
  }
  assert.ok(!/require\(['"](http|https|net|dns)['"]\)/.test(src), 'no network module may be required');

  // And it says so, where somebody would go looking.
  assert.match(src, /nothing is fetched/i);
});

test('the page states the rules where somebody is about to record something', async () => {
  const doc = await html('/admin/opportunities', { cookie });

  assert.match(doc, /Nothing here fetches anything/i);
  // Every source's rule is on the page, not just in the source file.
  for (const s of opportunities.SOURCES) {
    assert.ok(doc.includes(s.label), 'the page should list the source: ' + s.label);
  }
  assert.match(doc, /Read by hand only/, 'the middle posture must be visible, since it is the subtle one');
  assert.match(doc, /Not used/, 'and so must the refusal');

  // The restricted source must not be offered in any dropdown.
  const selects = doc.match(/<select[\s\S]*?<\/select>/g) || [];
  for (const select of selects) {
    assert.ok(!select.includes('value="purchased_list"'), 'a restricted source must not be selectable');
  }
});

// ------------------------------------------------- the money chain

test('an estimate is ours, is optional, and is never a quote', async () => {
  const opp = await record({ title: 'Barn clearing, Montcalm', source_kind: 'public_notice', est_value: '1800' });
  assert.equal(opp.est_value_cents, 180000);

  // Optional, and junk becomes absent rather than zero.
  for (const value of ['', '   ', 'lots', '-50']) {
    const other = await record({ title: 'Estimate ' + value, source_kind: 'bid_board', est_value: value });
    assert.equal(other.est_value_cents, null, 'must not store: ' + JSON.stringify(value));
  }

  // It is not in the quotes table, and never counted as revenue.
  assert.equal(one('select count(*) as n from quotes').n, 0, 'an estimate creates no quote');
  const money = opportunities.moneyFor(app.read, opp.lead_id ? [opp.lead_id] : []);
  assert.equal(money.revenue, 0, 'an estimate is not revenue');
});

test('attaching a lead by reference is what makes the money real', async () => {
  const opp = await record({ title: 'Storage unit clearing, Belding', source_kind: 'storage_auction' });
  const lead = await newLead();

  const res = await app.post(
    '/admin/opportunities/' + opp.id + '/link',
    { work_ref: lead.work_ref },
    adminOpts()
  );
  assert.equal(res.status, 302);

  const after = one('select * from opportunities where id = ?', opp.id);
  assert.equal(after.lead_id, lead.id);
  assert.equal(after.status, 'won', 'a lead means it happened');

  // Lower case, as it would be typed off a card or read off a phone.
  const opp2 = await record({ title: 'Second find', source_kind: 'bid_board' });
  const lead2 = await newLead();
  await app.post('/admin/opportunities/' + opp2.id + '/link',
    { work_ref: lead2.work_ref.toLowerCase() }, adminOpts());
  assert.equal(one('select lead_id from opportunities where id = ?', opp2.id).lead_id, lead2.id);
});

test('a reference that matches nothing does not attach, and does not clear one', async () => {
  const opp = await record({ title: 'Third find', source_kind: 'bid_board' });
  const lead = await newLead();
  await app.post('/admin/opportunities/' + opp.id + '/link', { work_ref: lead.work_ref }, adminOpts());

  for (const bad of ['RYDJA-ZZZZZZ', 'nonsense', "'; drop table leads; --", 'RYDJA-000000']) {
    const res = await app.post('/admin/opportunities/' + opp.id + '/link', { work_ref: bad }, adminOpts());
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /link=notfound/, bad);
    assert.equal(
      one('select lead_id from opportunities where id = ?', opp.id).lead_id,
      lead.id,
      'a bad reference must not wipe the good link: ' + bad
    );
  }

  // The leads table survived.
  assert.ok(one('select count(*) as n from leads').n > 0);

  // Blank clears it, which is how a mistake is undone.
  await app.post('/admin/opportunities/' + opp.id + '/link', { work_ref: '' }, adminOpts());
  assert.equal(one('select lead_id from opportunities where id = ?', opp.id).lead_id, null);
});

test('revenue counts completed jobs, never approved quotes', async () => {
  const fresh = await startServer({ BUSINESS_PHONE: PHONE });
  try {
    const freshCookie = await fresh.adminCookie();
    const admin = { headers: { cookie: freshCookie }, ip: '203.0.113.98' };
    const row = (sql, ...a) => fresh.read.prepare(sql).get(...a);

    // One lead, quoted and approved but not finished.
    const stamp = await (async () => {
      const doc = await (await fresh.get('/quote')).text();
      return doc.match(/name="form_stamp" value="([^"]+)"/)[1];
    })();
    await fresh.post('/quote', submission({ form_stamp: stamp }), { ip: '198.51.100.50' });
    const lead = row('select * from leads order by id desc limit 1');

    await fresh.post('/admin/leads/' + lead.id + '/quote', { amount: '2400.00', notes: '' }, admin);
    await fresh.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '198.51.100.50' });

    let money = opportunities.moneyFor(fresh.read, [lead.id]);
    assert.equal(money.approved, 1, 'the approval is counted');
    assert.equal(money.approvedValue, 240000);
    assert.equal(money.revenue, 0, 'an approved quote is a promise, not revenue');

    // Finish it.
    const job = row('select * from jobs where lead_id = ? order by id desc limit 1', lead.id);
    await fresh.post('/admin/jobs/' + job.id + '/status', { status: 'complete' }, admin);

    money = opportunities.moneyFor(fresh.read, [lead.id]);
    assert.equal(money.completed, 1);
    assert.equal(money.revenue, 240000, 'a finished job is revenue');
  } finally {
    fresh.stop();
  }
});

test('the rollup is empty rather than wrong when there is nothing to roll up', () => {
  for (const ids of [[], null, undefined]) {
    const money = opportunities.moneyFor(app.read, ids);
    assert.equal(money.leads, 0);
    assert.equal(money.revenue, 0);
    assert.equal(money.approvedValue, 0);
  }
});

// ------------------------------------------------- the list and the deadlines

test('the default list is what is still live, and closed work is one click away', async () => {
  const live = await record({ title: 'Still open find', source_kind: 'bid_board' });
  const dead = await record({ title: 'Already passed find', source_kind: 'bid_board' });
  await app.post('/admin/opportunities/' + dead.id + '/edit',
    { title: dead.title, source_kind: 'bid_board', status: 'passed',
      outcome_note: 'Needed a certificate of insurance we do not hold.' }, adminOpts());

  const open = await html('/admin/opportunities', { cookie });
  assert.ok(open.includes('Still open find'));
  assert.ok(!open.includes('Already passed find'), 'a closed one is not in the default view');

  const all = await html('/admin/opportunities?all=1', { cookie });
  assert.ok(all.includes('Already passed find'), 'and is there when asked for');

  // Why we passed is kept, because it is what stops the same half-hour being
  // spent on the same dead end next quarter.
  assert.match(
    one('select outcome_note from opportunities where id = ?', dead.id).outcome_note,
    /certificate of insurance/
  );
});

test('a deadline inside the week shows up as due, and an old one does not hide', async () => {
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const soonDay = [soon.getFullYear(), String(soon.getMonth() + 1).padStart(2, '0'),
                   String(soon.getDate()).padStart(2, '0')].join('-');

  const far = new Date();
  far.setDate(far.getDate() + 60);
  const farDay = [far.getFullYear(), String(far.getMonth() + 1).padStart(2, '0'),
                  String(far.getDate()).padStart(2, '0')].join('-');

  const closing = await record({ title: 'Bid closes in three days', source_kind: 'bid_board', closes_on: soonDay });
  const later = await record({ title: 'Bid closes in two months', source_kind: 'bid_board', closes_on: farDay });

  const today = require('../analytics').localDay();
  const week = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0')].join('-');
  })();

  const due = opportunities.due(app.read, today, week);
  const ids = due.map((d) => d.id);
  assert.ok(ids.includes(closing.id), 'a deadline three days out is due');
  assert.ok(!ids.includes(later.id), 'one two months out is not');

  const doc = await html('/admin/opportunities', { cookie });
  assert.match(doc, /Needs you this week/);
  assert.ok(doc.includes('Bid closes in three days'));

  // And the dashboard carries the count.
  const dash = await html('/admin/dashboard', { cookie });
  assert.match(dash, /Opportunities due or closing/);
});

test('a date in the past is a valid record of when something closed', async () => {
  const past = new Date();
  past.setDate(past.getDate() - 10);
  const pastDay = [past.getFullYear(), String(past.getMonth() + 1).padStart(2, '0'),
                   String(past.getDate()).padStart(2, '0')].join('-');

  const opp = await record({ title: 'Sale that ended last week', source_kind: 'estate_sale_listing', closes_on: pastDay });
  assert.equal(opp.closes_on, pastDay, 'the owner catching up must not have the date silently dropped');

  // Nonsense is dropped rather than stored.
  for (const bad of ['not-a-date', '2026-13-45', '1999-01-01', '2099-01-01']) {
    const other = await record({ title: 'Closes ' + bad, source_kind: 'bid_board', closes_on: bad });
    assert.equal(other.closes_on, null, 'must be dropped: ' + bad);
  }
});

// ------------------------------------------------- the partner link

test('a partner can be credited for work they told us about without a link', async () => {
  const res = await app.post(
    '/admin/partners',
    { name: 'Flat River Estate Sales', kind: 'estate_sale', city: 'Lowell' },
    adminOpts()
  );
  const partnerId = Number(res.headers.get('location').split('/').pop());

  const opp = await record({
    title: 'House in Alto, Sue rang about it',
    source_kind: 'walk_in',
    partner_id: String(partnerId)
  });
  assert.equal(opp.partner_id, partnerId);

  // It shows on their page, which is the point: a partner who rings instead of
  // forwarding the URL must not look like a partner who produced nothing.
  const doc = await html('/admin/partners/' + partnerId, { cookie });
  assert.match(doc, /Work they told us about/);
  assert.ok(doc.includes('House in Alto'));
});

test('a partner id that does not exist is stored as nobody', async () => {
  for (const bad of ['99999', '0', '-1', 'abc', '']) {
    const opp = await record({ title: 'Partner ' + bad, source_kind: 'bid_board', partner_id: bad });
    assert.equal(opp.partner_id, null, 'must not store: ' + bad);
  }
});

// ------------------------------------------------- history, and the shared table

test('a conversation is logged, and moves a new find along', async () => {
  const opp = await record({ title: 'Needs a phone call', source_kind: 'public_notice' });
  assert.equal(opp.status, 'new');

  const res = await app.post(
    '/admin/opportunities/' + opp.id + '/touch',
    {
      channel: 'phone',
      direction: 'out',
      summary: 'Rang the clerk. Bid needs a certificate of insurance.',
      next_step: 'Pass on it'
    },
    adminOpts()
  );
  assert.equal(res.status, 302);

  const touch = one('select * from partner_touches where opportunity_id = ? order by id desc limit 1', opp.id);
  assert.ok(touch, 'the log shares the partner touch table');
  assert.equal(touch.partner_id, null, 'an opportunity touch belongs to no partner');
  assert.equal(touch.channel, 'phone');
  assert.equal(one('select status from opportunities where id = ?', opp.id).status, 'contacted');
});

test('the widened touch table still holds partner conversations', async () => {
  const res = await app.post('/admin/partners', { name: 'Still Works Co', kind: 'realtor' }, adminOpts());
  const partnerId = Number(res.headers.get('location').split('/').pop());

  await app.post(
    '/admin/partners/' + partnerId + '/touch',
    { channel: 'email', direction: 'out', summary: 'Emailed them.' },
    adminOpts()
  );

  const touch = one('select * from partner_touches where partner_id = ? order by id desc limit 1', partnerId);
  assert.ok(touch);
  assert.equal(touch.opportunity_id, null, 'a partner touch belongs to no opportunity');
  assert.match(touch.summary, /Emailed them/);
});

test('the migration that widened the touch table carried the existing rows over', async () => {
  // The real risk in that migration: SQLite cannot drop a NOT NULL with
  // ALTER, so the table is rebuilt -- and a rebuild that loses rows is the
  // worst possible outcome for a record of who was spoken to and when.
  const { DatabaseSync } = require('node:sqlite');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rydja-touch-'));
  const file = path.join(dir, 'app.db');

  const raw = new DatabaseSync(file);
  const db = {
    exec: (s) => raw.exec(s),
    prepare: (s) => {
      const st = raw.prepare(s);
      return {
        get: (...a) => st.get(...a),
        all: (...a) => st.all(...a),
        run: (...a) => {
          const r = st.run(...a);
          return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
        }
      };
    }
  };

  // The table as it was before opportunities existed, with rows in it.
  raw.exec(`
    create table partners (id integer primary key, name text);
    insert into partners (id, name) values (1, 'Old Partner');
    create table partner_touches (
      id integer primary key autoincrement,
      partner_id integer not null references partners(id),
      channel text not null,
      direction text not null default 'out',
      summary text not null,
      happened_on text,
      created_at text not null default (datetime('now'))
    );
    insert into partner_touches (partner_id, channel, direction, summary, happened_on)
      values (1, 'phone', 'out', 'Spoke to them in March', '2026-03-04'),
             (1, 'email', 'in', 'They replied', '2026-03-06');
  `);

  assert.equal(db.prepare('select count(*) as n from partner_touches').get().n, 2);

  opportunities.migrate(db);

  const after = db.prepare('select * from partner_touches order by id').all();
  assert.equal(after.length, 2, 'both rows survived the rebuild');
  assert.equal(after[0].summary, 'Spoke to them in March');
  assert.equal(after[0].happened_on, '2026-03-04');
  assert.equal(after[1].direction, 'in');
  assert.ok('opportunity_id' in after[0], 'and the new column is there');
  assert.equal(after[0].opportunity_id, null);

  // And it is safe to run twice, like every other migration here.
  opportunities.migrate(db);
  assert.equal(db.prepare('select count(*) as n from partner_touches').get().n, 2);

  raw.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------- the usual guards

test('the opportunity pages are admin-only', async () => {
  const opp = await record({ title: 'Private find', source_kind: 'bid_board' });

  for (const path of ['/admin/opportunities', '/admin/opportunities/' + opp.id]) {
    const res = await app.get(path);
    assert.equal(res.status, 302, path);
    assert.match(res.headers.get('location'), /\/admin\/login/);
  }
  for (const path of ['/admin/opportunities', '/admin/opportunities/' + opp.id + '/edit',
                      '/admin/opportunities/' + opp.id + '/touch',
                      '/admin/opportunities/' + opp.id + '/link',
                      '/admin/opportunities/' + opp.id + '/archive']) {
    const res = await app.post(path, { title: 'x', summary: 'x' }, { ip: '203.0.113.51' });
    assert.equal(res.status, 302, path);
    assert.match(res.headers.get('location'), /\/admin\/login/, path);
  }
});

test('an opportunity is archived rather than deleted', async () => {
  const opp = await record({ title: 'Archive this one', source_kind: 'bid_board' });
  const lead = await newLead();
  await app.post('/admin/opportunities/' + opp.id + '/link', { work_ref: lead.work_ref }, adminOpts());

  await app.post('/admin/opportunities/' + opp.id + '/archive', {}, adminOpts());
  const row = one('select * from opportunities where id = ?', opp.id);
  assert.ok(row, 'the row is still there');
  assert.ok(row.archived_at);
  assert.equal(row.lead_id, lead.id, 'and the lead it produced is still attached');

  assert.ok(!(await html('/admin/opportunities?all=1', { cookie })).includes('Archive this one'));

  await app.post('/admin/opportunities/' + opp.id + '/archive', { restore: '1' }, adminOpts());
  assert.equal(one('select archived_at from opportunities where id = ?', opp.id).archived_at, null);
});

test('a URL typed into a source field cannot become a dangerous link', async () => {
  const opp = await record({
    title: 'Hostile source URL',
    source_kind: 'bid_board',
    source_url: 'javascript:alert(document.cookie)'
  });
  assert.equal(opp.source_url, '', 'https or nothing, the same rule everywhere else');

  const doc = await html('/admin/opportunities/' + opp.id, { cookie });
  assert.ok(!doc.includes('javascript:alert'));
});

test('an opportunity that does not exist is a 404, not a crash', async () => {
  for (const path of ['/admin/opportunities/99999', '/admin/opportunities/0', '/admin/opportunities/abc']) {
    assert.equal((await app.get(path, { headers: { cookie } })).status, 404, path);
  }
});

test('nothing about an opportunity reaches a public page', async () => {
  const opp = await record({
    title: 'Confidential find nobody should see',
    source_kind: 'public_notice',
    contact_name: 'Private Clerk',
    phone: '6165550123',
    notes: 'Internal note about the bid.'
  });

  for (const path of ['/', '/quote', '/services', '/service-area', '/sitemap.xml',
                      '/junk-removal-lowell-mi', '/junk-removal-stanton-mi']) {
    const doc = await html(path);
    for (const secret of ['Confidential find', 'Private Clerk', '6165550123', 'Internal note']) {
      assert.ok(!doc.includes(secret), path + ' leaked: ' + secret);
    }
  }
  assert.ok(opp.id);
});

test('the dashboard shows what acquisition produced, and tells the two kinds apart', async () => {
  const doc = await html('/admin/dashboard', { cookie });

  assert.match(doc, /Acquisition, all time/);
  for (const label of ['Partners', 'Open opportunities', 'Leads from partners', 'Revenue from both']) {
    assert.ok(doc.includes(label), 'the dashboard needs: ' + label);
  }
  assert.match(doc, /href="\/admin\/opportunities"/);
  assert.match(doc, /href="\/admin\/partners"/);
});
