'use strict';

// Where a lead came from, worked out from the visitor's own first request.
//
// This is first-party and deliberately small. It reads the campaign parameters
// already in the URL you handed out, plus the Referer header the browser sends
// anyway, and keeps them in the existing signed session cookie until the
// visitor submits the quote form. There is no script, no identifier, no
// profile, no third party, and nothing that follows anyone to another site:
// what is stored says which link was clicked, not who clicked it.
//
// Two rules give the numbers their meaning:
//   - the first public page of a visit wins, so a visitor who arrives from an
//     ad and then browses to /quote is still credited to the ad
//   - nothing is inferred. A visit with no campaign and no referrer is
//     'direct', which is a fact; a lead that predates all of this is null,
//     which is an absence, and the two are never conflated.

/** Campaign parameters, in the order Google and everyone else writes them. */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

// Long enough for any real campaign name, short enough that the session cookie
// cannot be inflated by a crafted URL.
const MAX_LEN = 120;

// Anything a terminal or an HTML attribute would treat as structure rather
// than text. A campaign name is words.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

/** A trimmed, length-capped string, or null. Never undefined, never ''. */
function clean(value) {
  if (typeof value !== 'string') return null;
  // Control characters would end up in the admin page and in the database.
  const out = value.replace(CONTROL_CHARS, ' ').trim().slice(0, MAX_LEN);
  return out || null;
}

/**
 * The host of a Referer header, lowercased and without a leading www.
 *
 * The host only, never the path: the page someone was reading before they
 * arrived is their business, and the domain is all the owner needs to tell a
 * Facebook click from a Google one.
 */
function referrerHost(header) {
  const raw = clean(header);
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** Hosts that mean a search engine or a social network rather than a referral. */
const HOST_SOURCES = [
  [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com|instagram\.com)$/, 'facebook'],
  [/(^|\.)(bing\.com|msn\.com)$/, 'bing'],
  [/(^|\.)(duckduckgo\.com|yahoo\.[a-z.]+|ecosia\.org)$/, 'other']
];

/** The same names, as a visitor might type them into utm_source. */
const UTM_SOURCES = [
  [/^(google|googleads|google-ads|gads|adwords|gmb|google-business)$/, 'google'],
  [/^(facebook|fb|meta|instagram|ig|messenger)$/, 'facebook'],
  [/^(bing|microsoft|msn)$/, 'bing']
];

/**
 * One of: google | facebook | bing | referral | direct | other.
 *
 * A bucket for reading the dashboard, not a replacement for the raw values --
 * utm_source is stored untouched alongside it, so a campaign tagged with
 * something this does not recognise is still there to be read.
 */
function normalizeSource(utmSource, host) {
  if (utmSource) {
    const value = utmSource.toLowerCase();
    for (const [pattern, name] of UTM_SOURCES) if (pattern.test(value)) return name;
    return 'other';
  }
  if (host) {
    for (const [pattern, name] of HOST_SOURCES) if (pattern.test(host)) return name;
    return 'referral';
  }
  return 'direct';
}

/** Our own pages are not referrers. A visitor browsing the site is one visit. */
function isSelfReferral(host, siteUrl) {
  if (!host) return false;
  try {
    const own = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, '');
    return host === own;
  } catch {
    return false;
  }
}

/**
 * What to remember about this visit, from this request alone.
 *
 * `landingPath` is the path, never the query string: the campaign parameters
 * are already captured by name, and anything else in a URL someone was sent
 * is not ours to keep.
 */
function capture(req, siteUrl) {
  const query = req.query || {};
  const utm = {};
  for (const key of UTM_KEYS) utm[key] = clean(query[key]);

  const host = referrerHost(req.get && req.get('referer'));
  const external = isSelfReferral(host, siteUrl) ? null : host;

  return {
    source: normalizeSource(utm.utm_source, external),
    utm_source: utm.utm_source,
    medium: utm.utm_medium,
    campaign: utm.utm_campaign,
    content: utm.utm_content,
    term: utm.utm_term,
    referrer: external,
    landing_path: clean(req.path) || '/'
  };
}

/** The columns a lead carries, in insert order. */
const LEAD_COLUMNS = [
  'source', 'utm_source', 'medium', 'campaign', 'content', 'term', 'referrer', 'landing_path'
];

/**
 * Attribution values for a lead row, as a plain array in LEAD_COLUMNS order.
 *
 * A session with nothing in it yields nulls rather than 'direct'. A lead whose
 * visit we never saw is unknown, and recording a guess as a fact would make
 * every number built on top of it a little bit false.
 */
function leadValues(stored) {
  if (!stored || typeof stored !== 'object') return LEAD_COLUMNS.map(() => null);
  return LEAD_COLUMNS.map((key) => clean(stored[key]));
}

// ------------------------------------------------------------------ the cookie
//
// Attribution lives in its own cookie, separate from the session that carries
// an admin sign-in. They want opposite things: attribution is public, holds no
// authority, and has to outlive a browser restart so a click today still earns
// the lead next week; a sign-in is a credential and its lifetime is a security
// decision. Sharing one cookie means every change to one is a change to the
// other, and logging in used to wipe a visitor's attribution outright.
//
// Signed the same way the form stamp is -- HMAC-SHA256 over the payload, with a
// constant-time compare -- so a visitor cannot invent a campaign for themselves
// and nothing has to be trusted off the wire.

const crypto = require('crypto');

const COOKIE_NAME = 'ps_attr';

/** `<payload>.<signature>`, both base64url. */
function sign(value, secret) {
  const body = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url').slice(0, 32);
  return body + '.' + sig;
}

/** The value back, or null for anything at all suspicious. */
function unsign(raw, secret) {
  const [body, sig] = String(raw || '').split('.');
  if (!body || !sig) return null;

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url').slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Cookies off the request. Express does not parse them without cookie-parser,
 * and one small reader is a better trade than another dependency.
 */
function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** What this browser was already carrying, verified. Null if it had nothing. */
function fromRequest(req, secret) {
  return unsign(readCookie(req, COOKIE_NAME), secret);
}

/** How a source reads in the admin. Unknown is an absence, not a bucket. */
const SOURCE_LABELS = {
  google: 'Google',
  facebook: 'Facebook',
  bing: 'Bing',
  referral: 'Referral',
  direct: 'Direct',
  other: 'Other'
};

const sourceLabel = (value) => SOURCE_LABELS[value] || (value ? 'Other' : 'Unknown');

module.exports = {
  UTM_KEYS,
  LEAD_COLUMNS,
  SOURCE_LABELS,
  COOKIE_NAME,
  capture,
  leadValues,
  normalizeSource,
  referrerHost,
  sourceLabel,
  sign,
  unsign,
  readCookie,
  fromRequest
};
