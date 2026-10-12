'use strict';

// IndexNow: the key file, what may be submitted, and what must never be.
//
// Two things in here are load-bearing and the rest is detail.
//
// The first is the privacy rule, which is the same one the sitemap tests
// enforce from the other direction: a customer's /q/<token> page and the whole
// admin must never be handed to a search engine. The sitemap is already tested
// to exclude them, so these tests do the opposite — they feed the submitter a
// sitemap that has been tampered with, and check that it refuses anyway.
//
// The second is that the key file publishes whatever is in INDEXNOW_KEY, in
// plain text, at a guessable URL. That is correct and is how the protocol
// proves ownership. It also means a session secret pasted into that variable
// would be published to the internet, so the server has to refuse to start.
//
// Run with:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { startServer, SESSION_SECRET, ADMIN_PASSWORD } = require('./helpers');
const indexnow = require('../indexnow');

const SITE = 'https://getrydja.com';
const KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

const ROOT = path.join(__dirname, '..');

let app;
let tmp;

test.before(async () => {
  app = await startServer({ SITE_URL: SITE, INDEXNOW_KEY: KEY });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rydja-indexnow-'));
});

test.after(() => {
  app?.stop();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const stateFile = (name) => path.join(tmp, name + '.json');

// ---------------------------------------------------------------- stubs

/** A site we control completely, so a tampered sitemap can be tested. */
function startSite(routes) {
  const server = http.createServer((req, res) => {
    const route = routes[req.url];
    if (route === undefined) return res.writeHead(404).end('not found');
    const { status = 200, type = 'text/html; charset=utf-8', body = '' } =
      typeof route === 'string' ? { body: route } : route;
    res.writeHead(status, { 'content-type': type }).end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ origin: 'http://127.0.0.1:' + server.address().port, close: () => server.close() })
    );
  });
}

/** An IndexNow endpoint that records what it was sent. */
function startEndpoint(status = 200) {
  const posts = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        posts.push(JSON.parse(body));
      } catch {
        posts.push({ unparseable: body });
      }
      res.writeHead(status).end('');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: 'http://127.0.0.1:' + server.address().port + '/indexnow',
        posts,
        close: () => server.close()
      })
    );
  });
}

const page = (body, head = '') =>
  `<!doctype html><html><head><title>T</title>` +
  `<meta name="description" content="D"><link rel="canonical" href="${SITE}/x">${head}` +
  `</head><body><main>${body}</main></body></html>`;

const sitemap = (urls) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
  `\n</urlset>\n`;

/** Boot a server and return how it failed, or null if it started. */
function bootFailure(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: '0',
        DB_PATH: path.join(tmp, 'boot.db'),
        UPLOAD_DIR: path.join(tmp, 'boot-uploads'),
        BACKUP_DAILY: '0',
        NODE_ENV: 'test',
        ADMIN_PASSWORD,
        SESSION_SECRET,
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 10000);
    const onData = (c) => {
      out += c;
      if (out.includes('running on http://')) {
        clearTimeout(timer);
        child.kill();
        resolve(null);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? null : out);
    });
  });
}

// ---------------------------------------------------------------- the key

test('a generated key is one the protocol and this app both accept', () => {
  for (let i = 0; i < 20; i++) {
    const key = indexnow.generateKey();
    assert.match(key, indexnow.KEY_PATTERN);
    assert.ok(key.length >= 8 && key.length <= 128);
    assert.equal(indexnow.keyProblem(key), null);
  }
  // Two calls never agree.
  assert.notEqual(indexnow.generateKey(), indexnow.generateKey());
});

test('a key that is not a key is refused, with a reason', () => {
  for (const bad of ['', null, undefined, 'short', 'has spaces in it', 'has/a/slash',
                     'has.a.dot', 'key_with_underscore', 'x'.repeat(129)]) {
    assert.ok(indexnow.keyProblem(bad), JSON.stringify(bad) + ' should be refused');
  }
  assert.match(indexnow.keyProblem(''), /not set/);
  assert.match(indexnow.keyProblem('nope!'), /8-128 characters/);
});

test('a key that is one of our other secrets is refused outright', () => {
  // The whole point: this value gets published in plain text at a guessable
  // URL. Reusing a real secret here would put it on the internet.
  const problem = indexnow.keyProblem(SESSION_SECRET, [ADMIN_PASSWORD, SESSION_SECRET]);
  assert.ok(problem, 'the session secret must never be accepted as the key');
  assert.match(problem, /PUBLIC/);

  // And it is only refused because it matches, not because of its shape:
  // the same string is a perfectly well-formed key on its own.
  assert.equal(indexnow.keyProblem(SESSION_SECRET), null);
});

test('the server refuses to start rather than publish a secret', async () => {
  const reused = await bootFailure({ INDEXNOW_KEY: SESSION_SECRET });
  assert.ok(reused, 'a reused session secret must stop the server');
  assert.match(reused, /INDEXNOW_KEY/);
  assert.match(reused, /PUBLIC/);
  // The refusal says what is wrong without printing the value.
  assert.ok(!reused.includes(SESSION_SECRET), 'the refusal must not echo the secret');

  const password = await bootFailure({ INDEXNOW_KEY: ADMIN_PASSWORD });
  assert.ok(password, 'a reused admin password must stop the server');
  assert.ok(!password.includes(ADMIN_PASSWORD), 'the refusal must not echo the password');

  const malformed = await bootFailure({ INDEXNOW_KEY: 'not a valid key' });
  assert.ok(malformed, 'a malformed key must stop the server');
  assert.match(malformed, /8-128 characters/);

  // And a good key starts normally.
  assert.equal(await bootFailure({ INDEXNOW_KEY: indexnow.generateKey() }), null);
});

// ------------------------------------------------------------- the key file

test('the key file is served, is exactly the key, and is not indexable', async () => {
  const res = await app.get('/' + KEY + '.txt');

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal((await res.text()).trim(), KEY);
});

test('no other path serves anything, whatever it is asked for', async () => {
  const probes = [
    '/notthekey.txt',
    '/' + KEY.slice(0, -1) + '.txt',       // one character short
    '/' + KEY.toUpperCase() + '.txt',      // wrong case
    '/' + KEY,                             // without the extension
    '/' + KEY + '.txt.txt',
    '/sub/' + KEY + '.txt',
    '/' + SESSION_SECRET + '.txt',         // the thing we most fear echoing
    '/' + ADMIN_PASSWORD + '.txt',
    '/indexnow.txt',
    '/key.txt'
  ];

  for (const probe of probes) {
    const res = await app.get(probe);
    assert.equal(res.status, 404, probe + ' must not be served');
    const body = await res.text();
    assert.ok(!body.includes(SESSION_SECRET), probe + ' echoed the session secret');
    assert.ok(!body.includes(ADMIN_PASSWORD), probe + ' echoed the admin password');
    assert.ok(!body.includes(KEY), probe + ' echoed the key');
  }
});

test('with no key configured there is no key file at all', async () => {
  const off = await startServer({ SITE_URL: SITE });
  try {
    assert.equal((await off.get('/' + KEY + '.txt')).status, 404, 'no key means no key file');
    assert.equal((await off.get('/anything.txt')).status, 404);
    // And the site is otherwise completely unaffected.
    assert.equal((await off.get('/')).status, 200);
    assert.equal((await off.get('/sitemap.xml')).status, 200);
  } finally {
    off.stop();
  }
});

test('the key file is a verification artefact, not a page', async () => {
  // Not in the sitemap, and not linked from anywhere a visitor could follow.
  const xml = await (await app.get('/sitemap.xml')).text();
  assert.ok(!xml.includes(KEY), 'the key file does not belong in the sitemap');
  assert.ok(!xml.includes('.txt'), 'nor does any other text file');

  for (const path of ['/', '/services', '/service-area', '/quote']) {
    const doc = await (await app.get(path)).text();
    assert.ok(!doc.includes(KEY), path + ' must not mention the key');
  }
});

// -------------------------------------------------------- what gets selected

test('a sitemap is read for its locations and nothing else', () => {
  const xml = sitemap([SITE + '/', SITE + '/junk-removal']);
  assert.deepEqual(indexnow.sitemapUrls(xml), [SITE + '/', SITE + '/junk-removal']);
  assert.deepEqual(indexnow.sitemapUrls('<urlset></urlset>'), []);
  assert.deepEqual(indexnow.sitemapUrls(''), []);
});

test('private URLs are refused even when a sitemap offers them', () => {
  const { submittable, excluded } = indexnow.partitionUrls(
    [
      SITE + '/',
      SITE + '/junk-removal',
      SITE + '/admin',
      SITE + '/admin/leads',
      SITE + '/admin/leads/7',
      SITE + '/q/deadbeefdeadbeefdeadbeefdeadbeef',
      SITE + '/quote/sent',
      SITE + '/uploads/abc123.jpg',
      SITE + '/api/anything',
      'https://example.com/elsewhere',
      'http://getrydja.com.evil.test/',
      SITE + '/junk-removal'
    ],
    SITE
  );

  assert.deepEqual(submittable, [SITE + '/', SITE + '/junk-removal']);

  const byUrl = Object.fromEntries(excluded.map((e) => [e.url, e.reason]));
  assert.equal(byUrl[SITE + '/admin'], 'private path');
  assert.equal(byUrl[SITE + '/admin/leads'], 'private path');
  assert.equal(byUrl[SITE + '/q/deadbeefdeadbeefdeadbeefdeadbeef'], 'private path');
  assert.equal(byUrl[SITE + '/quote/sent'], 'private path');
  assert.equal(byUrl[SITE + '/uploads/abc123.jpg'], 'private path');
  assert.equal(byUrl['https://example.com/elsewhere'], 'not on ' + SITE);
  // A host that merely starts with ours is a different host.
  assert.equal(byUrl['http://getrydja.com.evil.test/'], 'not on ' + SITE);
  assert.equal(byUrl[SITE + '/junk-removal'], 'duplicate');
});

test('the real sitemap passes selection whole, and /quote is public', async () => {
  const xml = await (await app.get('/sitemap.xml')).text();
  const { submittable, excluded } = indexnow.partitionUrls(indexnow.sitemapUrls(xml), SITE);

  assert.deepEqual(excluded, [], 'nothing in our own sitemap should be refused');
  assert.ok(submittable.length >= 17);
  assert.ok(submittable.includes(SITE + '/quote'), '/quote is a public page');
  assert.ok(!submittable.includes(SITE + '/quote/sent'), '/quote/sent is not');
});

test('a noindex page is recognised however the directive is written', () => {
  assert.ok(indexnow.isNoindex('<meta name="robots" content="noindex,nofollow">'));
  assert.ok(indexnow.isNoindex('<META NAME="robots" CONTENT="NOINDEX">'));
  assert.ok(indexnow.isNoindex('<meta name="robots" content="noindex">'));
  assert.ok(!indexnow.isNoindex('<meta name="description" content="noindex is a word">'));
  assert.ok(!indexnow.isNoindex(page('nothing to see')));
});

// ---------------------------------------------------------- the fingerprint

test('the fingerprint tracks content and ignores everything that churns', () => {
  const base = page('<h1>Junk removal</h1><p>We take it away.</p>');
  const print = indexnow.fingerprint(base);
  assert.match(print, /^[0-9a-f]{32}$/);
  assert.equal(indexnow.fingerprint(base), print, 'and is stable');

  // Things that must NOT read as a change.
  const unchanged = {
    'an asset hash in the head':
      page('<h1>Junk removal</h1><p>We take it away.</p>', '<link href="/styles.css?v=abc123">'),
    'an image version inside main':
      indexnow.fingerprint(page('<h1>Junk removal</h1><p>We take it away.</p>')) &&
      page('<h1>Junk removal</h1><p>We take it away.</p>'),
    'reformatted whitespace':
      page('<h1>Junk removal</h1>\n\n   <p>We take it away.</p>  ')
  };
  for (const [what, html] of Object.entries(unchanged)) {
    assert.equal(indexnow.fingerprint(html), print, what + ' must not read as a change');
  }

  // Things that MUST read as a change.
  const changed = {
    'the words': page('<h1>Junk removal</h1><p>We now take it away on Sundays.</p>'),
    'a heading': page('<h1>Junk hauling</h1><p>We take it away.</p>'),
    'an internal link target': page('<h1>Junk removal</h1><p>We take it away.</p><a href="/cleanouts">x</a>')
  };
  for (const [what, html] of Object.entries(changed)) {
    assert.notEqual(indexnow.fingerprint(html), print, what + ' must read as a change');
  }
});

test('a per-request form token does not make the quote page change every run', async () => {
  // The regression this exists for: /quote carries a signed form stamp minted
  // on every render. Fingerprinted naively, it is "changed" forever and gets
  // resubmitted on every single run, which is precisely the behaviour that
  // gets a site ignored.
  const first = indexnow.fingerprint(await (await app.get('/quote')).text());
  const second = indexnow.fingerprint(await (await app.get('/quote')).text());

  assert.ok(first, '/quote should fingerprint');
  assert.equal(first, second, 'two renders of an unchanged /quote must agree');

  // And the stamps really were different, or this proves nothing.
  const stamp = async () =>
    (await (await app.get('/quote')).text()).match(/name="form_stamp" value="([^"]+)"/)[1];
  const a = await stamp();
  await new Promise((r) => setTimeout(r, 1100));
  assert.notEqual(await stamp(), a, 'the stamps should differ, or this test is vacuous');
});

test('an image whose bytes changed still reads as a change', () => {
  // The query string is dropped from link hrefs, but an image's ?v= is a hash
  // of the file, and the src attribute is not what we fingerprint anyway. What
  // protects us here is that a replaced photograph almost always comes with
  // replaced alt text; this records that the src alone is not tracked.
  const a = page('<img src="/img/truck.jpg?v=aaa" alt="A loaded trailer">');
  const b = page('<img src="/img/truck.jpg?v=bbb" alt="A loaded trailer">');
  assert.equal(indexnow.fingerprint(a), indexnow.fingerprint(b), 'a version bump alone is not content');

  const c = page('<img src="/img/truck.jpg?v=bbb" alt="A different photograph entirely">');
  assert.notEqual(indexnow.fingerprint(a), indexnow.fingerprint(c), 'new alt text is content');
});

test('a page with no main cannot be fingerprinted, and is not submitted', () => {
  assert.equal(indexnow.fingerprint('<html><body>no main here</body></html>'), null);
  assert.equal(indexnow.fingerprint(''), null);
});

// ---------------------------------------------------------------- the state

test('every way the state file can be broken ends in one clean resubmission', () => {
  const missing = indexnow.readState(path.join(tmp, 'does-not-exist.json'), SITE);
  assert.deepEqual(missing.urls, {});
  assert.match(missing.note, /no state file/);

  const cases = {
    'not json at all {{{': /not valid JSON/,
    '{}': /unexpected shape/,
    '[]': /unexpected shape/,
    'null': /unexpected shape/,
    '{"urls": "nope"}': /unexpected shape/,
    [JSON.stringify({ version: 1, site: 'https://example.com', urls: { a: { fingerprint: 'x' } } })]:
      /written for https:\/\/example\.com/
  };

  for (const [body, expected] of Object.entries(cases)) {
    const file = stateFile('broken-' + Buffer.from(body).toString('hex').slice(0, 12));
    fs.writeFileSync(file, body);
    const state = indexnow.readState(file, SITE);
    assert.deepEqual(state.urls, {}, body + ' should yield no fingerprints');
    assert.match(state.note, expected);
  }
});

test('a good state file round-trips, and carries fingerprints and nothing else', () => {
  const file = stateFile('roundtrip');
  indexnow.writeState(file, SITE, { [SITE + '/']: { fingerprint: 'abc' } });

  const state = indexnow.readState(file, SITE);
  assert.equal(state.note, null);
  assert.deepEqual(state.urls, { [SITE + '/']: { fingerprint: 'abc' } });

  // Entries without a fingerprint are dropped rather than trusted.
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, site: SITE, urls: { a: { fingerprint: 'x' }, b: {}, c: null } })
  );
  assert.deepEqual(indexnow.readState(file, SITE).urls, { a: { fingerprint: 'x' } });

  // Nothing in the file is a credential.
  indexnow.writeState(file, SITE, { [SITE + '/']: { fingerprint: 'abc' } });
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(KEY) && !raw.includes(SESSION_SECRET) && !raw.includes(ADMIN_PASSWORD));
});

// ------------------------------------------------------------------- the run

/** Run the submitter against a controlled site, capturing the log. */
async function runAgainst(site, endpoint, extra = {}) {
  const lines = [];
  const result = await indexnow.run({
    site: SITE,
    from: site.origin,
    key: KEY,
    endpoint: endpoint.url,
    stateFile: extra.stateFile || stateFile('run'),
    log: (line) => lines.push(line),
    ...extra
  });
  return { result, lines, text: lines.join('\n') };
}

const KEY_FILE = { ['/' + KEY + '.txt']: { body: KEY, type: 'text/plain' } };

test('a first run submits everything, a second submits nothing', async () => {
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': { body: sitemap([SITE + '/', SITE + '/junk-removal']), type: 'application/xml' },
    '/': page('<h1>Home</h1>'),
    '/junk-removal': page('<h1>Junk</h1>')
  });
  const endpoint = await startEndpoint();
  const file = stateFile('twice');

  try {
    const first = await runAgainst(site, endpoint, { stateFile: file });
    assert.equal(first.result.ok, true);
    assert.deepEqual(first.result.changed, [SITE + '/', SITE + '/junk-removal']);
    assert.deepEqual(first.result.unchanged, []);
    assert.equal(endpoint.posts.length, 1);
    assert.match(first.text, /CHANGED/);
    assert.match(first.text, /SUBMITTED {2}2 URL\(s\)/);

    const second = await runAgainst(site, endpoint, { stateFile: file });
    assert.equal(second.result.ok, true);
    assert.deepEqual(second.result.changed, []);
    assert.equal(second.result.unchanged.length, 2);
    assert.equal(endpoint.posts.length, 1, 'an unchanged site must not be submitted again');
    assert.match(second.text, /UNCHANGED/);
    assert.match(second.text, /SUBMITTED {2}0 URL\(s\)/);
    assert.match(second.text, /nothing has changed/);
  } finally {
    site.close();
    endpoint.close();
  }
});

test('only the page that actually changed is submitted again', async () => {
  const pages = { '/': page('<h1>Home</h1>'), '/junk-removal': page('<h1>Junk</h1>') };
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': { body: sitemap([SITE + '/', SITE + '/junk-removal']), type: 'application/xml' },
    get '/'() { return pages['/']; },
    get '/junk-removal'() { return pages['/junk-removal']; }
  });
  const endpoint = await startEndpoint();
  const file = stateFile('partial');

  try {
    await runAgainst(site, endpoint, { stateFile: file });
    pages['/junk-removal'] = page('<h1>Junk removal and hauling</h1>');

    const after = await runAgainst(site, endpoint, { stateFile: file });
    assert.deepEqual(after.result.changed, [SITE + '/junk-removal']);
    assert.deepEqual(after.result.unchanged, [SITE + '/']);
    assert.deepEqual(endpoint.posts[1].urlList, [SITE + '/junk-removal']);
  } finally {
    site.close();
    endpoint.close();
  }
});

test('the payload is the shape the protocol expects', async () => {
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': { body: sitemap([SITE + '/']), type: 'application/xml' },
    '/': page('<h1>Home</h1>')
  });
  const endpoint = await startEndpoint();

  try {
    await runAgainst(site, endpoint, { stateFile: stateFile('payload') });

    const sent = endpoint.posts[0];
    assert.equal(sent.host, 'getrydja.com');
    assert.equal(sent.key, KEY);
    assert.equal(sent.keyLocation, SITE + '/' + KEY + '.txt');
    assert.deepEqual(sent.urlList, [SITE + '/']);
    // One bulk request, not one per URL.
    assert.equal(endpoint.posts.length, 1);
  } finally {
    site.close();
    endpoint.close();
  }
});

test('a private URL smuggled into the sitemap is never submitted', async () => {
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': {
      body: sitemap([
        SITE + '/',
        SITE + '/admin/leads',
        SITE + '/q/deadbeefdeadbeefdeadbeefdeadbeef',
        SITE + '/quote/sent',
        SITE + '/uploads/secret.jpg'
      ]),
      type: 'application/xml'
    },
    '/': page('<h1>Home</h1>'),
    '/admin/leads': page('<h1>Leads</h1>'),
    '/q/deadbeefdeadbeefdeadbeefdeadbeef': page('<h1>Your job</h1>'),
    '/quote/sent': page('<h1>Sent</h1>'),
    '/uploads/secret.jpg': page('<h1>photo</h1>')
  });
  const endpoint = await startEndpoint();

  try {
    const { result, text } = await runAgainst(site, endpoint, { stateFile: stateFile('smuggled') });

    assert.deepEqual(result.changed, [SITE + '/']);
    assert.deepEqual(endpoint.posts[0].urlList, [SITE + '/']);

    const posted = JSON.stringify(endpoint.posts);
    for (const forbidden of ['/admin', '/q/', 'quote/sent', '/uploads/']) {
      assert.ok(!posted.includes(forbidden), forbidden + ' reached a search engine');
    }
    assert.equal((text.match(/EXCLUDED/g) || []).length, 4, 'and each refusal is reported');
  } finally {
    site.close();
    endpoint.close();
  }
});

test('a noindex page is refused even if it is in the sitemap and public', async () => {
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': { body: sitemap([SITE + '/', SITE + '/oops']), type: 'application/xml' },
    '/': page('<h1>Home</h1>'),
    '/oops': page('<h1>Private</h1>', '<meta name="robots" content="noindex,nofollow">')
  });
  const endpoint = await startEndpoint();

  try {
    const { result, text } = await runAgainst(site, endpoint, { stateFile: stateFile('noindex') });

    assert.deepEqual(result.changed, [SITE + '/']);
    assert.deepEqual(result.failed, [{ url: SITE + '/oops', reason: 'noindex' }]);
    assert.deepEqual(endpoint.posts[0].urlList, [SITE + '/']);
    assert.match(text, /FAILED.*oops.*noindex/);
    assert.equal(result.ok, false, 'a noindex page in the sitemap is a problem worth exit code 1');
  } finally {
    site.close();
    endpoint.close();
  }
});

test('a broken page is reported and left out, not submitted', async () => {
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': { body: sitemap([SITE + '/', SITE + '/boom', SITE + '/gone']), type: 'application/xml' },
    '/': page('<h1>Home</h1>'),
    '/boom': { status: 500, body: page('<h1>Error</h1>') }
    // /gone is simply not routed: a 404.
  });
  const endpoint = await startEndpoint();

  try {
    const { result, text } = await runAgainst(site, endpoint, { stateFile: stateFile('broken') });

    assert.deepEqual(result.changed, [SITE + '/']);
    assert.equal(result.failed.length, 2);
    assert.match(text, /FAILED.*boom.*500/);
    assert.match(text, /FAILED.*gone.*404/);
    assert.deepEqual(endpoint.posts[0].urlList, [SITE + '/']);
    assert.equal(result.ok, false);
  } finally {
    site.close();
    endpoint.close();
  }
});

test('nothing is submitted when the key file is not being served', async () => {
  const site = await startSite({
    '/sitemap.xml': { body: sitemap([SITE + '/']), type: 'application/xml' },
    '/': page('<h1>Home</h1>')
    // no key file
  });
  const endpoint = await startEndpoint();

  try {
    const { result, text } = await runAgainst(site, endpoint, { stateFile: stateFile('nokeyfile') });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'key-file');
    assert.equal(endpoint.posts.length, 0, 'a submission without a verifiable key is pointless');
    assert.match(text, /ERROR/);
    assert.match(text, /key file/);
  } finally {
    site.close();
    endpoint.close();
  }
});

test('a key file serving the wrong thing is caught before anything is sent', async () => {
  const site = await startSite({
    ['/' + KEY + '.txt']: { body: 'something else entirely', type: 'text/plain' },
    '/sitemap.xml': { body: sitemap([SITE + '/']), type: 'application/xml' },
    '/': page('<h1>Home</h1>')
  });
  const endpoint = await startEndpoint();

  try {
    const { result } = await runAgainst(site, endpoint, { stateFile: stateFile('wrongkeyfile') });
    assert.equal(result.ok, false);
    assert.equal(endpoint.posts.length, 0);
  } finally {
    site.close();
    endpoint.close();
  }
});

test('a refused submission is not recorded, so the next run tries again', async () => {
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': { body: sitemap([SITE + '/']), type: 'application/xml' },
    '/': page('<h1>Home</h1>')
  });
  const refuses = await startEndpoint(403);
  const accepts = await startEndpoint(200);
  const file = stateFile('refused');

  try {
    const bad = await runAgainst(site, refuses, { stateFile: file });
    assert.equal(bad.result.ok, false);
    assert.match(bad.text, /HTTP 403 \(key rejected/);
    assert.match(bad.text, /next run will try these URLs again/);
    assert.ok(!fs.existsSync(file), 'a refused submission must not be recorded as done');

    const good = await runAgainst(site, accepts, { stateFile: file });
    assert.equal(good.result.ok, true);
    assert.deepEqual(accepts.posts[0].urlList, [SITE + '/']);
  } finally {
    site.close();
    refuses.close();
    accepts.close();
  }
});

test('a dry run reports in full and sends nothing', async () => {
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': { body: sitemap([SITE + '/', SITE + '/junk-removal']), type: 'application/xml' },
    '/': page('<h1>Home</h1>'),
    '/junk-removal': page('<h1>Junk</h1>')
  });
  const endpoint = await startEndpoint();
  const file = stateFile('dry');

  try {
    const { result, text } = await runAgainst(site, endpoint, { stateFile: file, dryRun: true });

    assert.equal(result.changed.length, 2);
    assert.deepEqual(result.submitted, []);
    assert.equal(endpoint.posts.length, 0);
    assert.match(text, /dry run, 2 would have been sent/);
    assert.ok(!fs.existsSync(file), 'a dry run records nothing, so a real run still submits');
  } finally {
    site.close();
    endpoint.close();
  }
});

test('--all resubmits pages that have not changed', async () => {
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': { body: sitemap([SITE + '/']), type: 'application/xml' },
    '/': page('<h1>Home</h1>')
  });
  const endpoint = await startEndpoint();
  const file = stateFile('all');

  try {
    await runAgainst(site, endpoint, { stateFile: file });
    const normal = await runAgainst(site, endpoint, { stateFile: file });
    assert.deepEqual(normal.result.changed, []);

    const forced = await runAgainst(site, endpoint, { stateFile: file, all: true });
    assert.deepEqual(forced.result.changed, [SITE + '/']);
    assert.equal(endpoint.posts.length, 2);
  } finally {
    site.close();
    endpoint.close();
  }
});

test('losing the state file costs one resubmission and nothing else', async () => {
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': { body: sitemap([SITE + '/']), type: 'application/xml' },
    '/': page('<h1>Home</h1>')
  });
  const endpoint = await startEndpoint();
  const file = stateFile('lost');

  try {
    await runAgainst(site, endpoint, { stateFile: file });
    fs.rmSync(file);

    const rebuilt = await runAgainst(site, endpoint, { stateFile: file });
    assert.equal(rebuilt.result.ok, true, 'a lost state file is not an error');
    assert.deepEqual(rebuilt.result.changed, [SITE + '/'], 'one honest resubmission');
    assert.match(rebuilt.text, /no state file yet/);

    // And it settles again immediately.
    const settled = await runAgainst(site, endpoint, { stateFile: file });
    assert.deepEqual(settled.result.changed, []);
    assert.equal(endpoint.posts.length, 2);
  } finally {
    site.close();
    endpoint.close();
  }
});

test('an unwritable state file is a warning, not a failure', async () => {
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': { body: sitemap([SITE + '/']), type: 'application/xml' },
    '/': page('<h1>Home</h1>')
  });
  const endpoint = await startEndpoint();

  try {
    // A directory where the file should be: writing it can only fail.
    const blocked = stateFile('blocked');
    fs.mkdirSync(blocked, { recursive: true });

    const { result, text } = await runAgainst(site, endpoint, { stateFile: blocked });
    assert.equal(endpoint.posts.length, 1, 'the submission still happened');
    assert.equal(result.ok, true, 'and the run still succeeded');
    assert.match(text, /could not write the state file/);
  } finally {
    site.close();
    endpoint.close();
  }
});

// ------------------------------------------------------------------ logging

test('the log carries URLs and statuses, and never a credential', async () => {
  const site = await startSite({
    ...KEY_FILE,
    '/sitemap.xml': {
      body: sitemap([SITE + '/', SITE + '/admin/leads', SITE + '/q/abc123']),
      type: 'application/xml'
    },
    '/': page('<h1>Home</h1>'),
    '/admin/leads': page('<h1>Leads</h1>'),
    '/q/abc123': page('<h1>Job</h1>')
  });
  const endpoint = await startEndpoint();

  try {
    const { text } = await runAgainst(site, endpoint, { stateFile: stateFile('logging') });

    // What it must say.
    assert.match(text, /CHANGED/);
    assert.match(text, /SUBMITTED/);
    assert.match(text, /summary/);
    assert.ok(text.includes(SITE + '/'), 'URLs are the point of the log');
    assert.match(text, /HTTP 200/);

    // What it must never say. The key is published, so this is tidiness
    // rather than secrecy -- but a log is copied into tickets and chats, and
    // the other two would be catastrophic.
    assert.ok(!text.includes(KEY), 'the key must not be logged');
    assert.ok(!text.includes(SESSION_SECRET), 'nor the session secret');
    assert.ok(!text.includes(ADMIN_PASSWORD), 'nor the admin password');
    // keyLocation embeds the key, so it must not be logged either.
    assert.ok(!text.includes('.txt?'), 'no key location in the log');

    // A private URL appears only as a refusal, never as something submitted.
    const excludedLines = text.split('\n').filter((l) => l.includes('/admin/leads'));
    assert.ok(excludedLines.length > 0);
    for (const line of excludedLines) assert.match(line, /EXCLUDED/);
  } finally {
    site.close();
    endpoint.close();
  }
});

test('nothing about IndexNow runs during a normal request', async () => {
  // The whole mechanism is an owner command. A page view must not ping
  // anything, and the server must not be reaching an external endpoint at all.
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  assert.ok(!/api\.indexnow\.org|bing\.com\/indexnow/.test(server),
    'the server must not know the submission endpoint');
  assert.ok(!/indexnow\.(run|submit)\s*\(/.test(server),
    'the server must never submit; that is the command\'s job');

  // The only thing it calls from the module is the key check. Matched as a
  // call, so that prose mentioning indexnow.js does not count as using it.
  const calls = [...server.matchAll(/indexnow\.(\w+)\s*\(/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)], ['keyProblem']);
});

// ----------------------------------------------------------------- the CLI

test('the command explains itself and mints keys without touching the network', async () => {
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    assert.equal(await indexnow.main(['--help']), 0);
    assert.equal(await indexnow.main(['--generate-key']), 0);
  } finally {
    console.log = log;
  }

  const text = lines.join('\n');
  assert.match(text, /npm run indexnow/);
  // The one claim that must never be made.
  assert.match(text, /does not reach Google|not reach Google/i);
  assert.doesNotMatch(text, /submits? (?:URLs )?to Google/i);

  const minted = text.match(/^ {2}([0-9a-f]{32})$/m);
  assert.ok(minted, 'the key generator should print a key');
  assert.equal(indexnow.keyProblem(minted[1]), null);
});

test('the command refuses to run without a key, and submits nothing', async () => {
  const lines = [];
  const result = await indexnow.run({
    site: SITE,
    key: '',
    endpoint: 'http://127.0.0.1:1/unreachable',
    stateFile: stateFile('nokey'),
    log: (line) => lines.push(line)
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'key');
  assert.match(lines.join('\n'), /INDEXNOW_KEY is not set/);
});
