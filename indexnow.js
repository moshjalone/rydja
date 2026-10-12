'use strict';

// IndexNow for RYDJA.
//
// IndexNow is a ping. You tell participating search engines "these URLs
// changed", they decide whether and when to come and look. That is the whole
// protocol.
//
// WHAT IT IS NOT:
//
//   * It is not Google. Google does not participate in IndexNow. Submitting
//     here does nothing for Google Search, and nothing in this file or in the
//     documentation around it may suggest otherwise. Google is Search Console,
//     the sitemap, and being worth crawling.
//   * It is not a crawler. We do not discover URLs. The sitemap is the list of
//     indexable pages, it is maintained by hand, and the test suite already
//     fails if it drifts from the routes. This reads that list and nothing
//     else.
//   * It is not part of serving the site. Nothing here runs on an HTTP
//     request. The server's only involvement is one static text route that
//     answers with the key, and the website runs perfectly well with none of
//     this configured.
//
// Participating engines include Bing, Yandex, Seznam, Naver and IndexNow.org
// itself; submitting to one endpoint shares with the others.
//
// HOW IT IS RUN:
//
//   npm run indexnow                after a deployment that changed page copy
//   npm run indexnow -- --dry-run   show what would be sent, send nothing
//   npm run indexnow -- --all       resubmit everything, ignoring state
//   npm run indexnow:key            mint a key to put in INDEXNOW_KEY
//
// THE STATE FILE:
//
// data/indexnow-state.json holds one content fingerprint per URL, and that is
// all it holds. Its only job is to stop us pinging seventeen unchanged pages
// every time a stylesheet is edited.
//
// It is deliberately disposable. It is gitignored, it is not deployed, the
// website never reads it, and losing it costs exactly one redundant
// submission of pages that had not changed -- which is a nuisance, not a
// problem. Missing, unreadable, corrupt, or written for a different site all
// resolve the same way: start clean and submit everything once.
//
// A URL is submitted when its *content* fingerprint differs from the recorded
// one. Never because a timestamp moved, never because a deploy happened,
// never because the state file was touched. The fingerprint is taken from the
// page's canonical URL, title, meta description and <main> -- the public,
// indexable substance of the page -- so an asset-hash bump in <head> or a
// change to the shared footer does not read as seventeen changed pages.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// The spec: 8 to 128 characters, a-z A-Z 0-9 and hyphen. Anything else is
// rejected by the API, so it is rejected here first with a sentence that says
// why rather than a 400 three steps later.
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

// One endpoint, shared with every participating engine. Bing's own
// (www.bing.com/indexnow) works too and reaches fewer of them.
const DEFAULT_ENDPOINT = 'https://api.indexnow.org/indexnow';

const DEFAULT_STATE = path.join(__dirname, 'data', 'indexnow-state.json');

// Everything that must never be submitted, whatever a sitemap says. The
// sitemap is already tested to exclude all of this, so in normal operation
// nothing matches -- which is the point. This is the second lock, here so
// that a hand-edited sitemap, a bad merge or a future generated one cannot
// quietly hand a customer's private URL to a search engine.
//
//   /admin           the whole back office
//   /q/<token>       a customer's own job page; the token IS the capability
//   /quote/sent      a confirmation page, noindex
//   /uploads/        customer photographs
//   /api/
//
// Private pages are also checked individually at fetch time for a noindex
// directive, so a page does not have to be on this list to be protected.
const PRIVATE_PATH = /^\/(?:admin(?:\/|$)|q\/|quote\/sent(?:$|\/)|uploads\/|api\/)/;

// ---------------------------------------------------------------- the key

/** A fresh key: 32 hex characters, well inside the 8-128 the spec allows. */
function generateKey() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * What is wrong with this key, or null if nothing is.
 *
 * `forbidden` is every other secret the process holds. The check matters
 * because of what the key is FOR: it is published, in full, as plain text, at
 * a guessable URL on the public site. That is not a leak, it is the ownership
 * proof the protocol is built on -- the engine fetches the file to confirm
 * whoever submitted the URLs controls the host.
 *
 * Which means pasting the session secret or the admin password into
 * INDEXNOW_KEY would publish it to the internet, and the site would look
 * exactly the same afterwards. Cheap to check, catastrophic to miss, so the
 * server refuses to start rather than serve it.
 */
function keyProblem(key, forbidden = []) {
  if (!key) return 'is not set';
  if (!KEY_PATTERN.test(key)) {
    return 'must be 8-128 characters of a-z, A-Z, 0-9 and hyphen (run: npm run indexnow:key)';
  }
  for (const secret of forbidden) {
    if (secret && key === secret) {
      return 'is one of this app\'s other secrets. The key file is PUBLIC -- setting this would publish that secret. Generate a dedicated key: npm run indexnow:key';
    }
  }
  return null;
}

/** Where the key file lives for a given site. */
const keyLocationFor = (site, key) => stripSlash(site) + '/' + key + '.txt';

// ------------------------------------------------------------- URL selection

const stripSlash = (s) => String(s || '').replace(/\/+$/, '');

/** Every <loc> in a sitemap, in document order. */
function sitemapUrls(xml) {
  return [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

/**
 * Split a sitemap's URLs into what may be submitted and what may not.
 *
 * IndexNow rejects a batch outright if any URL is on a different host from the
 * declared one, so the origin check is not only a safety rule -- a single
 * stray URL would lose the whole submission.
 */
function partitionUrls(locs, site) {
  const origin = stripSlash(site);
  const submittable = [];
  const excluded = [];
  const seen = new Set();

  for (const loc of locs) {
    const reject = (reason) => excluded.push({ url: loc, reason });

    if (!loc.startsWith(origin + '/') && loc !== origin + '/') {
      reject('not on ' + origin);
      continue;
    }
    const pathname = loc.slice(origin.length) || '/';
    if (PRIVATE_PATH.test(pathname)) {
      reject('private path');
      continue;
    }
    if (seen.has(loc)) {
      reject('duplicate');
      continue;
    }
    seen.add(loc);
    submittable.push(loc);
  }

  return { submittable, excluded };
}

// -------------------------------------------------------------- the page

/** Does this page tell crawlers to stay away? */
function isNoindex(html) {
  const tag = String(html).match(/<meta\s+name="robots"\s+content="([^"]*)"/i);
  return Boolean(tag && /noindex/i.test(tag[1]));
}

/**
 * A fingerprint of the part of a page a search engine actually indexes.
 *
 * Four things: the canonical URL, the title, the meta description, and the
 * *visible text* of <main> plus the internal links it contains.
 *
 * Every exclusion here is deliberate, and each one exists because including it
 * would have produced a submission that told Bing nothing:
 *
 *   <head> and the chrome          ?v= asset hashes move on every release, and
 *                                  the header and footer are shared furniture.
 *                                  Hashing them marks all seventeen pages
 *                                  changed every single deploy.
 *   attributes inside <main>       /quote carries a signed form stamp, minted
 *                                  per request, and date fields carry today's
 *                                  date as a min. Both change constantly and
 *                                  neither is content. Left in, /quote would
 *                                  be resubmitted on every run forever.
 *   query strings on links         an image's ?v= is a hash of the image file,
 *                                  so a genuinely changed image still registers
 *                                  through the rest of the page.
 *
 * Internal link paths are kept, sorted and deduplicated, so retargeting a CTA
 * or adding a related-work link counts as a change even when the words around
 * it are identical. The trade-off, stated plainly: a change to an external
 * link's href alone would not register. That is a fair price for never
 * crying wolf.
 *
 * Returns null for a page with no <main>, which is not a page we should be
 * submitting anyway.
 */
function fingerprint(html) {
  const doc = String(html);
  const open = doc.indexOf('<main');
  const close = doc.indexOf('</main>');
  if (open === -1 || close === -1 || close < open) return null;

  const main = doc.slice(open, close);
  const pick = (re) => { const m = doc.match(re); return m ? m[1] : ''; };

  const text = main
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const links = [
    ...new Set([...main.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1].split('?')[0]))
  ].sort();

  // Alt text is the one attribute that is genuinely indexable content -- it is
  // what a search engine reads of an image, and what a screen reader says. A
  // replaced photograph with new alt text has to count as a change; the src's
  // ?v= hash beside it does not, and is not looked at.
  const alts = [...main.matchAll(/\salt="([^"]*)"/g)].map((m) => m[1]);

  const parts = [
    pick(/<link rel="canonical" href="([^"]*)"/),
    pick(/<title>([\s\S]*?)<\/title>/).replace(/\s+/g, ' ').trim(),
    pick(/<meta name="description" content="([^"]*)"/),
    text,
    links.join(' '),
    alts.join(' ')
  ];

  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

// --------------------------------------------------------------- the state

/**
 * The recorded fingerprints, or an empty set and a reason why.
 *
 * Never throws. Every failure mode -- no file, unreadable, not JSON, the wrong
 * shape, written for a different site -- lands in the same place: no
 * fingerprints, a note for the log, and one honest round of resubmission.
 */
function readState(file, site) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { urls: {}, note: 'no state file yet — treating every page as changed' };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { urls: {}, note: 'state file is not valid JSON — rebuilding it from this run' };
  }

  if (!data || typeof data !== 'object' || !data.urls || typeof data.urls !== 'object') {
    return { urls: {}, note: 'state file has an unexpected shape — rebuilding it from this run' };
  }
  if (data.site && stripSlash(data.site) !== stripSlash(site)) {
    return { urls: {}, note: 'state file was written for ' + data.site + ' — rebuilding it for this site' };
  }

  const urls = {};
  for (const [url, entry] of Object.entries(data.urls)) {
    if (entry && typeof entry.fingerprint === 'string') urls[url] = { fingerprint: entry.fingerprint };
  }
  return { urls, note: null };
}

/**
 * Record the fingerprints. Written to a temporary file and renamed, so an
 * interrupted write leaves the previous state intact rather than a truncated
 * file -- and a truncated file would only have cost one resubmission anyway.
 *
 * `updated` is for a human reading the file. Nothing compares against it.
 */
function writeState(file, site, urls) {
  const body = JSON.stringify(
    { version: 1, site: stripSlash(site), updated: new Date().toISOString(), urls },
    null,
    2
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, body + '\n');
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------- submission

/**
 * One bulk POST. The protocol takes up to 10,000 URLs in a batch; we have
 * seventeen, so there is no paging to write and none is written.
 *
 * The key appears in the payload and in keyLocation, and neither is ever
 * returned to the caller for logging.
 */
async function submit({ endpoint, site, key, urls, fetchImpl = fetch }) {
  const host = new URL(stripSlash(site)).host;
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host,
      key,
      keyLocation: keyLocationFor(site, key),
      urlList: urls
    })
  });

  // 200 accepted, 202 accepted with the key still being validated. Everything
  // else is a refusal worth printing.
  return { status: res.status, ok: res.status === 200 || res.status === 202 };
}

/** What a status code actually means, in words, for the log. */
function explain(status) {
  return {
    200: 'accepted',
    202: 'accepted — key validation pending',
    400: 'bad request — the payload was malformed',
    403: 'key rejected — the key file could not be verified',
    422: 'rejected — a URL does not belong to this host, or the key does not match',
    429: 'rate limited — too many submissions, try again later'
  }[status] || 'unexpected response';
}

// ------------------------------------------------------------------- the run

/**
 * Fetch every indexable URL, work out which actually changed, and submit those.
 *
 * `from` exists for dry runs against a server that is not production: the
 * canonical URLs out of the sitemap are what get submitted, but they are
 * fetched from this origin instead. That is how this is tested without
 * touching the live site, and how you can preview a submission from localhost.
 */
async function run(options = {}) {
  const log = options.log || ((line) => console.log(line));
  const say = (label, rest) => log(`[indexnow] ${label.padEnd(11)}${rest}`);

  const site = stripSlash(options.site || process.env.SITE_URL || 'https://getrydja.com');
  const key = (options.key || process.env.INDEXNOW_KEY || '').trim();
  const endpoint = options.endpoint || process.env.INDEXNOW_ENDPOINT || DEFAULT_ENDPOINT;
  const stateFile = options.stateFile || process.env.INDEXNOW_STATE || DEFAULT_STATE;
  const from = stripSlash(options.from || site);
  const fetchImpl = options.fetchImpl || fetch;
  const dryRun = Boolean(options.dryRun);
  const all = Boolean(options.all);

  // Fetch a canonical URL from wherever we have been told to read the site.
  const fetchPage = (url) => fetchImpl(from === site ? url : from + url.slice(site.length));

  const problem = keyProblem(key);
  if (problem) {
    say('ERROR', 'INDEXNOW_KEY ' + problem);
    return { ok: false, reason: 'key', submitted: [], changed: [], unchanged: [], failed: [] };
  }

  say('site', site);
  if (from !== site) say('reading', from + '  (URLs submitted are still the canonical ones)');

  // The key file has to be reachable and correct before anything is submitted.
  // Without it the engine cannot verify ownership, and the whole batch is
  // refused -- so check it here, where the error can say what to do about it.
  let keyFileOk = false;
  try {
    const res = await fetchPage(keyLocationFor(site, key));
    keyFileOk = res.status === 200 && (await res.text()).trim() === key;
    if (!keyFileOk) say('ERROR', `key file is not being served correctly (HTTP ${res.status})`);
  } catch (err) {
    say('ERROR', 'key file could not be fetched: ' + err.message);
  }
  if (!keyFileOk) {
    say('', 'Set INDEXNOW_KEY on the server and redeploy, then try again.');
    return { ok: false, reason: 'key-file', submitted: [], changed: [], unchanged: [], failed: [] };
  }
  say('key file', 'reachable and correct');

  // The sitemap is the list of indexable pages. We do not discover URLs.
  let locs;
  try {
    const res = await fetchPage(site + '/sitemap.xml');
    if (res.status !== 200) throw new Error('HTTP ' + res.status);
    locs = sitemapUrls(await res.text());
  } catch (err) {
    say('ERROR', 'could not read the sitemap: ' + err.message);
    return { ok: false, reason: 'sitemap', submitted: [], changed: [], unchanged: [], failed: [] };
  }

  const { submittable, excluded } = partitionUrls(locs, site);
  say('sitemap', `${locs.length} URL(s), ${submittable.length} submittable`);
  for (const skip of excluded) say('EXCLUDED', `${skip.url} — ${skip.reason}`);

  const state = readState(stateFile, site);
  if (state.note) say('state', state.note);

  const changed = [];
  const unchanged = [];
  const failed = [];
  const fingerprints = {};

  for (const url of submittable) {
    let res;
    try {
      res = await fetchPage(url);
    } catch (err) {
      failed.push({ url, reason: err.message });
      say('FAILED', `${url} — ${err.message}`);
      continue;
    }

    if (res.status !== 200) {
      failed.push({ url, reason: 'HTTP ' + res.status });
      say('FAILED', `${url} — HTTP ${res.status}`);
      continue;
    }

    const html = await res.text();

    // The last line of defence, and the one that does not depend on a path
    // pattern: a page that asks not to be indexed is never submitted, whatever
    // the sitemap says about it.
    if (isNoindex(html)) {
      failed.push({ url, reason: 'noindex' });
      say('FAILED', `${url} — noindex, and it should not be in the sitemap`);
      continue;
    }

    const print = fingerprint(html);
    if (!print) {
      failed.push({ url, reason: 'no main content' });
      say('FAILED', `${url} — no <main> content to fingerprint`);
      continue;
    }

    fingerprints[url] = { fingerprint: print };
    if (!all && state.urls[url] && state.urls[url].fingerprint === print) {
      unchanged.push(url);
      say('UNCHANGED', url);
    } else {
      changed.push(url);
      say('CHANGED', url);
    }
  }

  log('[indexnow]');
  say('summary', `${changed.length} changed, ${unchanged.length} unchanged, ${failed.length} failed`);

  if (!changed.length) {
    say('SUBMITTED', '0 URL(s) — nothing has changed, so nothing was sent');
    // Still record fingerprints: a first run after losing the state file needs
    // to write what it found, or the next run repeats the whole submission.
    if (!dryRun) persist();
    return finish(true);
  }

  if (dryRun) {
    say('SUBMITTED', `0 URL(s) — dry run, ${changed.length} would have been sent`);
    return finish(true);
  }

  let result;
  try {
    result = await submit({ endpoint, site, key, urls: changed, fetchImpl });
  } catch (err) {
    say('FAILED', 'submission request failed: ' + err.message);
    return finish(false);
  }

  say('SUBMITTED', `${changed.length} URL(s) to ${new URL(endpoint).host} — HTTP ${result.status} (${explain(result.status)})`);

  if (!result.ok) {
    say('', 'Nothing was recorded, so the next run will try these URLs again.');
    return finish(false);
  }

  persist();
  say('', 'Bing and other participating engines have been notified. This does not reach Google.');
  return finish(true);

  // Record what we fetched, merged over what we already had, so a URL that
  // failed this run keeps its previous fingerprint rather than being forgotten.
  function persist() {
    try {
      writeState(stateFile, site, Object.assign({}, state.urls, fingerprints));
    } catch (err) {
      // The website does not read this file and nothing depends on it. Say so
      // and carry on -- the cost is one redundant submission next time.
      say('warning', 'could not write the state file (' + err.message + '); next run will resubmit');
    }
  }

  function finish(ok) {
    return { ok: ok && !failed.length, submitted: ok && !dryRun ? changed : [], changed, unchanged, failed };
  }
}

// ----------------------------------------------------------------- the CLI

const USAGE = `
Notify Bing and other IndexNow engines that RYDJA pages have changed.

  npm run indexnow                  submit the pages whose content changed
  npm run indexnow -- --dry-run     show what would be sent, send nothing
  npm run indexnow -- --all         resubmit every indexable URL
  npm run indexnow:key              mint a key for INDEXNOW_KEY

  --from=<origin>   read the site from somewhere else (e.g. a local server)
                    while still submitting the canonical production URLs

Reads SITE_URL and INDEXNOW_KEY from the environment.

Note: IndexNow does not reach Google. Google does not participate in the
protocol; for Google it is the sitemap and Search Console that matter.
`.trim();

async function main(argv) {
  const has = (flag) => argv.includes(flag);
  const valueOf = (name) => {
    const hit = argv.find((a) => a.startsWith(name + '='));
    return hit ? hit.slice(name.length + 1) : undefined;
  };

  if (has('--help') || has('-h')) {
    console.log(USAGE);
    return 0;
  }

  if (has('--generate-key')) {
    const key = generateKey();
    console.log(
      [
        'A new IndexNow key:',
        '',
        '  ' + key,
        '',
        'Set it as INDEXNOW_KEY on the server and redeploy. The site will then',
        'serve it at /' + key + '.txt, which is how an engine verifies that',
        'whoever submits URLs for this host actually controls it.',
        '',
        'It is published by design, so it is not a secret — but never reuse one',
        'of this app\'s real secrets here, and do not commit this to the repo.'
      ].join('\n')
    );
    return 0;
  }

  const result = await run({
    dryRun: has('--dry-run'),
    all: has('--all'),
    from: valueOf('--from'),
    site: valueOf('--site')
  });

  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error('[indexnow] ERROR      ' + err.message);
      process.exit(1);
    }
  );
}

module.exports = {
  DEFAULT_ENDPOINT,
  KEY_PATTERN,
  PRIVATE_PATH,
  generateKey,
  keyProblem,
  keyLocationFor,
  sitemapUrls,
  partitionUrls,
  isNoindex,
  fingerprint,
  readState,
  writeState,
  submit,
  run,
  main
};
