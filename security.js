'use strict';

// Rate limiting and bot filtering, in memory, no dependencies.
//
// This app runs as a single process on a single machine (SQLite on a local
// disk requires that anyway), so an in-memory counter is accurate — there is
// no second instance holding a different count. If this app is ever run on
// more than one instance, these limits become per-instance and need Redis.

const crypto = require('crypto');

// ---------------------------------------------------------------- rate limit

/**
 * Fixed-window counter keyed by IP. Returns middleware.
 *
 * @param {object}   opts
 * @param {number}   opts.windowMs  length of the window
 * @param {number}   opts.max       requests allowed per window
 * @param {string}   opts.name      label used in logs
 * @param {Function} opts.onBlock   (req, res) => void — renders the refusal
 */
function rateLimit({ windowMs, max, name, onBlock }) {
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const hits = new Map();

  // Drop expired entries so a long-running process cannot grow unbounded.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, Math.min(windowMs, 10 * 60 * 1000));
  sweep.unref();

  return function rateLimitMiddleware(req, res, next) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      console.warn(`[ratelimit] ${name}: blocked ${key} (${entry.count} in window)`);
      return onBlock(req, res, retryAfter);
    }

    next();
  };
}

/** Let a successful login forgive the attempts that led up to it. */
function makeLoginLimiter(onBlock) {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    name: 'admin-login',
    onBlock
  });
  return limiter;
}

// ---------------------------------------------------------------- bot filter

// A real submission is a human filling a form: it takes more than a couple of
// seconds, and it leaves the decoy field alone. Neither check inconveniences a
// real customer, and neither needs a third-party captcha.

const MIN_FILL_MS = 3000;            // faster than this is scripted
const MAX_FORM_AGE_MS = 6 * 60 * 60 * 1000; // stale form, make them reload

/** Signed timestamp embedded in the form so the age cannot be forged. */
function formStamp(secret) {
  const issued = Date.now().toString(36);
  const sig = crypto.createHmac('sha256', secret).update(issued).digest('base64url').slice(0, 16);
  return `${issued}.${sig}`;
}

/**
 * @returns {'ok'|'too_fast'|'expired'|'bad'} why the submission was refused
 */
function checkStamp(value, secret) {
  const [issued, sig] = String(value || '').split('.');
  if (!issued || !sig) return 'bad';

  const expected = crypto.createHmac('sha256', secret).update(issued).digest('base64url').slice(0, 16);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'bad';

  const age = Date.now() - parseInt(issued, 36);
  if (!isFinite(age)) return 'bad';
  if (age < MIN_FILL_MS) return 'too_fast';
  if (age > MAX_FORM_AGE_MS) return 'expired';
  return 'ok';
}

/** The honeypot is hidden from people and irresistible to naive bots. */
const HONEYPOT_FIELD = 'company_website';

const honeypotTripped = (body) => Boolean(String(body?.[HONEYPOT_FIELD] || '').trim());

module.exports = {
  rateLimit,
  makeLoginLimiter,
  formStamp,
  checkStamp,
  honeypotTripped,
  HONEYPOT_FIELD,
  MIN_FILL_MS
};
