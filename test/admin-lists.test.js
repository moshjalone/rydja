'use strict';

// Searching, filtering, sorting, editing and bulk actions in the admin.
//
// The two things that matter most here are that nothing is ever destroyed --
// "delete" is an archive, and an archived row leaves every total rather than
// taking its money with it -- and that none of the query string reaches SQL as
// SQL.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, freshStamp, submission } = require('./helpers');

let app;
let cookie;

test.after(() => app?.stop());

// ---------------------------------------------------------------- helpers

const admin = (url) => app.get(url, { headers: { cookie } });
const page = async (url) => (await admin(url)).text();

const post = (url, fields) =>
  app.post(url, fields, { headers: { cookie }, ip: '203.0.113.99' });

/** Repeated name/value pairs, the way a checkbox group posts. */
function pairs(fields) {
  const out = [];
  for (const [key, value] of Object.entries(fields)) {
    for (const one of [].concat(value)) out.push([key, String(one)]);
  }
  return out;
}

/** How many selectable rows a list rendered. */
const rowCount = (html) => (html.match(/name="ids" value=/g) || []).length;

/** The ids of those rows, in the order they appear. */
const rowIds = (html) => [...html.matchAll(/name="ids" value="(\d+)"/g)].map((m) => Number(m[1]));

/** Customer names in row order, from the table only -- not the metric tiles. */
function rowNames(html) {
  const table = html.split('class="jobs selectable"')[1] || '';
  return (table.match(/<strong>([^<]+)<\/strong>/g) || []).map((s) => s.replace(/<\/?strong>/g, ''));
}

/** A lead through the public form, returned as its row. */
async function makeLead(fields, ip) {
  const body = pairs({ ...submission(fields), form_stamp: await freshStamp(app) });
  const res = await app.post('/quote', body, { ip });
  assert.equal(res.status, 302, 'the form should have accepted it');
  return app.read.prepare('select * from leads order by id desc limit 1').get();
}

/** Carry a lead all the way to a complete job with one expense against it. */
async function makeCompletedJob(lead, amount = '450.00') {
  await post('/admin/leads/' + lead.id + '/quote', { amount, notes: '' });
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.60' });
  const job = app.read.prepare('select * from jobs where lead_id = ? order by id desc limit 1').get(lead.id);
  await post('/admin/jobs/' + job.id + '/status', { status: 'complete' });
  await post('/admin/jobs/' + job.id + '/expenses', { category: 'dump', amount: '60.00', note: '' });
  return app.read.prepare('select * from jobs where id = ?').get(job.id);
}

// Five leads with distinct, searchable details.
const PEOPLE = [
  { name: 'Dana Reed', phone: '6165550301', city: 'Lowell', zip: '49331', service: 'Estate / whole-property cleanout' },
  { name: 'Marcus Webb', phone: '6165550302', city: 'Stanton', zip: '48888', service: 'Junk / hauling' },
  { name: 'Priya Shah', phone: '6165550303', city: 'Lowell', zip: '49331', service: 'Garage / basement cleanout' },
  { name: 'Tom Oakley', phone: '6165550304', city: 'Belding', zip: '48809', service: 'Yard / brush cleanup' },
  { name: 'Nina Alvarez', phone: '6165550305', city: 'Greenville', zip: '48838', service: 'Junk / hauling' }
];

// One hook: the server has to be up before any lead can be submitted, and two
// separate before() hooks do not reliably sequence against each other.
test.before(async () => {
  app = await startServer({ SITE_URL: 'https://getrydja.com', BUSINESS_PHONE: '1-616-929-3360' });
  cookie = await app.adminCookie();

  let n = 0;
  for (const p of PEOPLE) {
    await makeLead(
      { name: p.name, phone: p.phone, city: p.city, zip: p.zip, service: p.service, email: '' },
      '203.0.113.' + (120 + n++)
    );
  }
});

// ---------------------------------------------------------------- search

test('the search box finds a customer by name', async () => {
  assert.equal(rowCount(await page('/admin/leads?q=Priya')), 1);
  assert.equal(rowNames(await page('/admin/leads?q=Priya'))[0], 'Priya Shah');
});

test('searching is case insensitive and matches part of a word', async () => {
  assert.equal(rowCount(await page('/admin/leads?q=alvar')), 1);
  assert.equal(rowCount(await page('/admin/leads?q=ALVAR')), 1);
});

test('a phone number is found however it is punctuated', async () => {
  for (const typed of ['6165550302', '(616) 555-0302', '616-555-0302', '616 555 0302']) {
    assert.equal(rowCount(await page('/admin/leads?q=' + encodeURIComponent(typed))), 1, typed);
  }
});

test('a work reference, a city and a ZIP all find their leads', async () => {
  const lead = app.read.prepare("select work_ref from leads where zip = '48809'").get();
  assert.equal(rowCount(await page('/admin/leads?q=' + lead.work_ref)), 1, 'by reference');
  assert.equal(rowCount(await page('/admin/leads?q=Lowell')), 2, 'two leads in Lowell');
  assert.equal(rowCount(await page('/admin/leads?q=49331')), 2, 'same two by ZIP');
});

test('a search that matches nothing says so instead of listing everything', async () => {
  const html = await page('/admin/leads?q=zzzznothing');
  assert.equal(rowCount(html), 0);
  assert.match(html, /Nothing matches that/);
});

test('LIKE wildcards typed by the user are literal characters', async () => {
  // '%' would otherwise match every row.
  assert.equal(rowCount(await page('/admin/leads?q=%25')), 0, 'a percent sign matches nothing here');
  assert.equal(rowCount(await page('/admin/leads?q=_')), 0, 'and so does an underscore');
});

test('the job board searches the same way', async () => {
  const lead = app.read.prepare("select * from leads where zip = '48838'").get();
  await makeCompletedJob(lead);

  assert.equal(rowCount(await page('/admin/jobs?q=Nina')), 1);
  assert.equal(rowCount(await page('/admin/jobs?q=(616)%20555-0305')), 1);
  assert.equal(rowCount(await page('/admin/jobs?q=zzzznothing')), 0);
});

// ---------------------------------------------------------------- filters

test('leads filter by status', async () => {
  assert.equal(rowCount(await page('/admin/leads?status=new')), 4, 'four still new');
  assert.equal(rowCount(await page('/admin/leads?status=converted')), 1, 'one converted');
});

test('leads filter by service, and estate work has its own option', async () => {
  assert.equal(rowCount(await page('/admin/leads?service=' + encodeURIComponent('Junk / hauling'))), 2);
  assert.equal(rowCount(await page('/admin/leads?service=__estate__')), 1, 'the estate lead');
});

test('the estate filter also catches the old label', async () => {
  // 'Estate cleanout' is what estate leads were called before the rename, and
  // leads taken then still carry it. The intake form stores the service as
  // given, so posting that label is exactly how such a row came to exist.
  const lead = await makeLead(
    { name: 'Older Estate', phone: '6165550306', service: 'Estate cleanout', email: '' },
    '203.0.113.130'
  );
  assert.equal(lead.service, 'Estate cleanout');

  assert.equal(rowCount(await page('/admin/leads?service=__estate__')), 2, 'both labels');
});

test('leads filter by source, and Unknown is its own bucket', async () => {
  // Nothing in this suite arrives with attribution, so all of them are unknown.
  assert.equal(rowCount(await page('/admin/leads?source=unknown')), 6);
  assert.equal(rowCount(await page('/admin/leads?source=google')), 0);
});

test('jobs filter by status', async () => {
  assert.equal(rowCount(await page('/admin/jobs?status=complete')), 1);
  assert.equal(rowCount(await page('/admin/jobs?status=cancelled')), 0);
});

test('an unknown filter value is ignored rather than obeyed', async () => {
  const all = rowCount(await page('/admin/leads'));
  assert.equal(rowCount(await page('/admin/leads?status=nonsense')), all);
  assert.equal(rowCount(await page('/admin/leads?source=nonsense')), all);
  assert.equal(rowCount(await page('/admin/leads?service=nonsense')), all);
});

// ---------------------------------------------------------------- sorting

test('leads sort by name, oldest and newest', async () => {
  const byName = rowNames(await page('/admin/leads?sort=name'));
  assert.deepEqual(
    byName,
    [...byName].sort((a, b) => a.localeCompare(b)),
    'A to Z'
  );

  const oldest = rowIds(await page('/admin/leads?sort=oldest'));
  const newest = rowIds(await page('/admin/leads?sort=newest'));
  assert.deepEqual(newest, [...oldest].reverse(), 'one is the other backwards');
});

test('an unknown sort falls back to the default instead of reaching SQL', async () => {
  const fallback = rowIds(await page('/admin/leads?sort=; drop table leads'));
  const smart = rowIds(await page('/admin/leads?sort=smart'));
  assert.deepEqual(fallback, smart);
  // And the table is still there.
  assert.ok(app.read.prepare('select count(*) as n from leads').get().n > 0);
});

test('jobs sort by revenue and by net', async () => {
  const second = app.read.prepare("select * from leads where zip = '49331' order by id limit 1").get();
  await makeCompletedJob(second, '900.00');

  const html = await page('/admin/jobs?sort=revenue');
  assert.equal(rowCount(html), 2);
  const amounts = [...html.matchAll(/data-label="Revenue">\$([\d,]+)\.\d\d/g)].map((m) =>
    Number(m[1].replace(/,/g, ''))
  );
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a), 'highest first');

  const byNet = await page('/admin/jobs?sort=net');
  const nets = [...byNet.matchAll(/data-label="Net"[^>]*>\$([\d,]+)\.\d\d/g)].map((m) =>
    Number(m[1].replace(/,/g, ''))
  );
  assert.deepEqual(nets, [...nets].sort((a, b) => b - a), 'highest first');
});

// ---------------------------------------------------------------- archiving

test('archiving takes leads out of the inbox without deleting anything', async () => {
  const before = app.read.prepare('select count(*) as n from leads').get().n;
  const ids = rowIds(await page('/admin/leads')).slice(0, 2);

  const res = await post('/admin/leads/bulk', pairs({ ids, action: 'archive' }));
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /done=archived&n=2/);

  assert.equal(rowCount(await page('/admin/leads')), before - 2, 'gone from the inbox');
  assert.equal(rowCount(await page('/admin/leads?view=archived')), 2, 'and in the archive');
  assert.equal(
    app.read.prepare('select count(*) as n from leads').get().n,
    before,
    'every row is still in the database'
  );
});

test('restoring puts them back', async () => {
  const ids = rowIds(await page('/admin/leads?view=archived'));
  assert.equal(ids.length, 2);

  const res = await post('/admin/leads/bulk', pairs({ ids, action: 'restore', view: 'archived' }));
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /done=restored&n=2/);
  assert.equal(rowCount(await page('/admin/leads?view=archived')), 0);
});

test('an archived lead takes its job off the board, and back on when restored', async () => {
  const job = app.read.prepare('select * from jobs order by id desc limit 1').get();
  const onBoard = rowCount(await page('/admin/jobs'));

  await post('/admin/leads/bulk', pairs({ ids: [job.lead_id], action: 'archive' }));
  assert.equal(rowCount(await page('/admin/jobs')), onBoard - 1, 'the job went with the lead');
  assert.match(await page('/admin/jobs?view=archived'), /via archived lead/, 'and says why');

  await post('/admin/leads/bulk', pairs({ ids: [job.lead_id], action: 'restore', view: 'archived' }));
  assert.equal(rowCount(await page('/admin/jobs')), onBoard, 'and came back with it');
});

/** A labelled money tile on the dashboard, in cents. */
async function dashCents(label) {
  const html = await page('/admin/dashboard');
  const marker = '<span>' + label + '</span><strong>$';
  const at = html.indexOf(marker);
  assert.notEqual(at, -1, 'no dashboard tile labelled ' + label);
  const value = html.slice(at + marker.length, html.indexOf('<', at + marker.length));
  return Math.round(Number(value.replace(/,/g, '')) * 100);
}

test('archiving a job removes its money from the dashboard and the board', async () => {
  const job = app.read.prepare("select * from jobs where status = 'complete' order by id desc limit 1").get();
  const revenue = job.customer_total_cents;
  const expenses = app.read
    .prepare('select coalesce(sum(amount_cents), 0) as n from job_expenses where job_id = ?')
    .get(job.id).n;
  assert.ok(revenue > 0 && expenses > 0, 'the job should carry money on both sides');

  const revenueBefore = await dashCents('Customer revenue');
  const expensesBefore = await dashCents('Recorded expenses');

  await post('/admin/jobs/bulk', pairs({ ids: [job.id], action: 'archive' }));

  assert.equal(await dashCents('Customer revenue'), revenueBefore - revenue, 'its revenue left the month');
  assert.equal(await dashCents('Recorded expenses'), expensesBefore - expenses, 'and so did its expenses');

  // Nothing was destroyed on the way: the row and its children are intact and
  // only a timestamp changed.
  const still = app.read.prepare('select * from jobs where id = ?').get(job.id);
  assert.equal(still.customer_total_cents, revenue);
  assert.ok(still.archived_at, 'archived, not deleted');
  assert.equal(
    app.read.prepare('select coalesce(sum(amount_cents), 0) as n from job_expenses where job_id = ?').get(job.id).n,
    expenses,
    'the expenses are still there'
  );

  // And restoring brings the money back.
  await post('/admin/jobs/bulk', pairs({ ids: [job.id], action: 'restore', view: 'archived' }));
  assert.equal(await dashCents('Customer revenue'), revenueBefore, 'restored to the month');
});

test('a bulk action with nothing selected says so and changes nothing', async () => {
  const before = app.read.prepare('select count(*) as n from leads where archived_at is not null').get().n;
  const res = await post('/admin/leads/bulk', pairs({ action: 'archive' }));
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /done=nothing/);
  assert.equal(
    app.read.prepare('select count(*) as n from leads where archived_at is not null').get().n,
    before
  );
});

test('junk ids are dropped and the real ones still apply', async () => {
  const real = rowIds(await page('/admin/leads'))[0];
  const res = await post(
    '/admin/leads/bulk',
    pairs({ ids: [real, 'abc', '-1', '0', '9999999', "1; drop table leads"], action: 'archive' })
  );
  assert.equal(res.status, 302);

  assert.ok(app.read.prepare('select archived_at from leads where id = ?').get(real).archived_at, 'the real one');
  assert.ok(app.read.prepare('select count(*) as n from leads').get().n > 0, 'the table survives');

  await post('/admin/leads/bulk', pairs({ ids: [real], action: 'restore', view: 'archived' }));
});

test('an unknown bulk action does nothing at all', async () => {
  const ids = rowIds(await page('/admin/leads')).slice(0, 2);
  const before = app.read.prepare('select count(*) as n from leads where archived_at is not null').get().n;

  const res = await post('/admin/leads/bulk', pairs({ ids, action: 'status:nonsense' }));
  assert.equal(res.status, 302);
  assert.equal(
    app.read.prepare('select count(*) as n from leads where archived_at is not null').get().n,
    before
  );
});

test('a bulk status change applies to everything ticked', async () => {
  const ids = rowIds(await page('/admin/leads?status=new')).slice(0, 2);
  assert.equal(ids.length, 2);

  const res = await post('/admin/leads/bulk', pairs({ ids, action: 'status:declined' }));
  assert.match(res.headers.get('location'), /done=status&n=2/);

  for (const id of ids) {
    assert.equal(app.read.prepare('select status from leads where id = ?').get(id).status, 'declined');
  }
});

test('a bulk action returns to the filtered view it came from', async () => {
  const ids = rowIds(await page('/admin/leads?q=Lowell')).slice(0, 1);
  const res = await post('/admin/leads/bulk', pairs({ ids, action: 'status:new', q: 'Lowell', sort: 'name' }));

  const back = res.headers.get('location');
  assert.match(back, /q=Lowell/, 'the search is kept');
  assert.match(back, /sort=name/, 'and the sort');
});

// ---------------------------------------------------------------- editing

test('editing a lead saves the customer and the job details', async () => {
  const lead = app.read.prepare('select * from leads order by id limit 1').get();

  const res = await post('/admin/leads/' + lead.id + '/edit', {
    name: 'Dana Reed-Smith',
    phone: '6165559999',
    email: 'dana.new@example.com',
    service: 'Junk / hauling',
    address: '9 Elm Street',
    city: 'Ada',
    state: 'MI',
    zip: '49301',
    access: 'Side gate',
    timing: 'Next week',
    description: 'Rewritten through the admin edit form, long enough to pass.',
    status: 'quoted'
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /done=saved/);

  const after = app.read
    .prepare('select l.*, c.name, c.phone, c.email from leads l join customers c on c.id = l.customer_id where l.id = ?')
    .get(lead.id);
  assert.equal(after.name, 'Dana Reed-Smith');
  assert.equal(after.phone, '6165559999');
  assert.equal(after.email, 'dana.new@example.com');
  assert.equal(after.city, 'Ada');
  assert.equal(after.zip, '49301');
  assert.equal(after.status, 'quoted');
});

test('an edit with a bad ZIP is refused and nothing is written', async () => {
  const lead = app.read.prepare('select * from leads order by id limit 1').get();

  const res = await post('/admin/leads/' + lead.id + '/edit', {
    name: 'Still Fine', phone: '6165559999', email: '', service: 'Junk / hauling',
    address: '', city: '', state: '', zip: 'NOT-A-ZIP', access: '', timing: '',
    description: 'Long enough to be valid.', status: 'new'
  });

  assert.equal(res.status, 400);
  assert.match(await res.text(), /valid ZIP/);
  assert.equal(app.read.prepare('select zip from leads where id = ?').get(lead.id).zip, '49301', 'unchanged');
});

test('an edit onto another customer\'s phone number is refused', async () => {
  const [a, b] = app.read.prepare('select l.id, c.phone from leads l join customers c on c.id = l.customer_id order by l.id').all();

  const res = await post('/admin/leads/' + a.id + '/edit', {
    name: 'Clasher', phone: b.phone, email: '', service: 'Junk / hauling',
    address: '', city: '', state: '', zip: '49331', access: '', timing: '',
    description: 'Long enough to be valid.', status: 'new'
  });

  assert.equal(res.status, 400);
  assert.match(await res.text(), /already used by another customer/);
});

test('editing an approved quote keeps the acceptance record and notes the old amount', async () => {
  const lead = await makeLead({ name: 'Edna Price', phone: '6165550401', email: '' }, '203.0.113.140');
  await post('/admin/leads/' + lead.id + '/quote', { amount: '450.00', notes: 'Original note.' });
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.140' });

  const before = app.read.prepare('select * from quotes where lead_id = ?').get(lead.id);
  assert.equal(before.status, 'approved');
  assert.ok(before.responded_at && before.terms_version, 'it has an acceptance record');

  await post('/admin/leads/' + lead.id + '/edit', {
    name: 'Edna Price', phone: '6165550401', email: '', service: lead.service,
    address: '', city: '', state: '', zip: lead.zip, access: '', timing: '',
    description: lead.description, status: 'converted', amount: '525.00'
  });

  const after = app.read.prepare('select * from quotes where id = ?').get(before.id);
  assert.equal(after.amount_cents, 52500, 'the amount changed');
  assert.equal(after.status, 'approved', 'it is still approved');
  assert.equal(after.responded_at, before.responded_at, 'when they agreed is untouched');
  assert.equal(after.terms_version, before.terms_version, 'and which Terms they saw');
  assert.match(after.notes, /Original note\./, 'the original note survives');
  assert.match(after.notes, /Amount edited by admin.*was \$450\.00/, 'and the old figure is recorded');

  // The owner can see that on the lead page, not only in the database.
  assert.match(await page('/admin/leads/' + lead.id), /Amount edited by admin/);
});

test('editing a quote amount moves the job total with it', async () => {
  const lead = await makeLead({ name: 'Total Mover', phone: '6165550402', email: '' }, '203.0.113.141');
  await post('/admin/leads/' + lead.id + '/quote', { amount: '300.00', notes: '' });
  await app.post('/q/' + lead.public_token + '/respond', { decision: 'approve' }, { ip: '203.0.113.141' });

  await post('/admin/leads/' + lead.id + '/edit', {
    name: 'Total Mover', phone: '6165550402', email: '', service: lead.service,
    address: '', city: '', state: '', zip: lead.zip, access: '', timing: '',
    description: lead.description, status: 'converted', amount: '375.00'
  });

  const job = app.read.prepare('select * from jobs where lead_id = ?').get(lead.id);
  assert.equal(job.customer_total_cents, 37500, 'the open job follows the quote');
});

test('editing a job sets its status, its total and its booked time', async () => {
  const job = app.read.prepare('select * from jobs order by id desc limit 1').get();

  const res = await post('/admin/jobs/' + job.id + '/edit', {
    status: 'scheduled',
    scheduled_for: '2026-12-15T09:30',
    customer_total: '640.00'
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /done=saved/);

  const after = app.read.prepare('select * from jobs where id = ?').get(job.id);
  assert.equal(after.status, 'scheduled');
  assert.equal(after.customer_total_cents, 64000);
  assert.equal(after.scheduled_for, '2026-12-15 09:30', 'stored as wall clock, T replaced');
});

test('clearing the time on a job un-books it', async () => {
  const job = app.read.prepare('select * from jobs order by id desc limit 1').get();
  await post('/admin/jobs/' + job.id + '/edit', {
    status: 'unscheduled', scheduled_for: '', customer_total: '640.00'
  });
  assert.equal(app.read.prepare('select scheduled_for from jobs where id = ?').get(job.id).scheduled_for, null);
});

test('a job edit with no total is refused', async () => {
  const job = app.read.prepare('select * from jobs order by id desc limit 1').get();
  const res = await post('/admin/jobs/' + job.id + '/edit', {
    status: 'unscheduled', scheduled_for: '', customer_total: ''
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /valid customer total/);
});

test('marking a job complete through the edit form stamps completed_at', async () => {
  const job = app.read.prepare('select * from jobs order by id desc limit 1').get();
  await post('/admin/jobs/' + job.id + '/edit', {
    status: 'complete', scheduled_for: '', customer_total: '640.00'
  });
  assert.ok(app.read.prepare('select completed_at from jobs where id = ?').get(job.id).completed_at);
});

// ---------------------------------------------------------------- the guard

test('every new admin route still demands a login', async () => {
  const lead = app.read.prepare('select id from leads order by id limit 1').get();
  const job = app.read.prepare('select id from jobs order by id limit 1').get();

  const guarded = [
    ['GET', '/admin/leads?q=Dana'],
    ['GET', '/admin/leads/' + lead.id + '/edit'],
    ['GET', '/admin/jobs?view=archived'],
    ['GET', '/admin/jobs/' + job.id + '/edit'],
    ['POST', '/admin/leads/bulk'],
    ['POST', '/admin/jobs/bulk'],
    ['POST', '/admin/leads/' + lead.id + '/edit'],
    ['POST', '/admin/jobs/' + job.id + '/edit']
  ];

  for (const [method, url] of guarded) {
    const res = method === 'GET' ? await app.get(url) : await app.post(url, {}, { ip: '203.0.113.200' });
    assert.equal(res.status, 302, method + ' ' + url);
    assert.match(res.headers.get('location'), /\/admin\/login/, method + ' ' + url);
  }
});

test('the admin lists stay out of any index', async () => {
  for (const url of ['/admin/leads', '/admin/jobs', '/admin/leads?view=archived']) {
    assert.match(await page(url), /name="robots" content="noindex,nofollow"/, url);
  }
});

test('no filter dropdown renders an object where a label belongs', async () => {
  for (const url of ['/admin/leads', '/admin/jobs']) {
    assert.ok(!(await page(url)).includes('[object Object]'), url);
  }
});
