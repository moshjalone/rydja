'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const multer = require('multer');

const { db, ownerOperator, generateWorkRef } = require('./db');
const { rateLimit, formStamp, checkStamp } = require('./security');
const { runBackup } = require('./backup');
const mail = require('./mail');
const { configFromEnv } = require('./s3');
const scheduleBackup = require('./schedule-backup');

// ---------------------------------------------------------------- config
//
// Secrets have no defaults on purpose. A silent fallback is how an app ends up
// on the internet with a password of "changeme". Refuse to start instead, and
// never log the values themselves.

const PLACEHOLDER_PASSWORDS = new Set([
  'changeme', 'change-me', 'password', 'admin', 'secret', 'letmein', 'test'
]);

function requiredSecrets() {
  const pw = process.env.ADMIN_PASSWORD || '';
  const secret = process.env.SESSION_SECRET || '';
  const problems = [];

  if (!pw) {
    problems.push('ADMIN_PASSWORD is not set.');
  } else if (PLACEHOLDER_PASSWORDS.has(pw.trim().toLowerCase())) {
    problems.push('ADMIN_PASSWORD is still a placeholder. Pick a real password.');
  } else if (pw.length < 12) {
    problems.push(`ADMIN_PASSWORD is too short (${pw.length} chars). Use at least 12.`);
  }

  if (!secret) {
    problems.push('SESSION_SECRET is not set.');
  } else if (secret.length < 32) {
    problems.push(`SESSION_SECRET is too short (${secret.length} chars). Use at least 32.`);
  } else if (/^(change|dev-only|secret|test)/i.test(secret.trim())) {
    problems.push('SESSION_SECRET is still a placeholder. Generate a random one.');
  }

  if (problems.length) {
    // Note: the offending values are never printed, only what is wrong with them.
    console.error('\nRefusing to start — fix these in your .env file:\n');
    for (const p of problems) console.error('  * ' + p);
    console.error('\nGenerate a strong value with:');
    console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
    process.exit(1);
  }

  return { pw, secret };
}

const { pw: ADMIN_PASSWORD, secret: SESSION_SECRET } = requiredSecrets();

const PORT = process.env.PORT || 3000;
const BRAND = process.env.BRAND_NAME || 'RYDJA';
const TAGLINE = process.env.BRAND_TAGLINE || 'Clear the way.';
const PHONE = process.env.BUSINESS_PHONE || '';

// Used for canonical and link-preview URLs. No trailing slash.
const SITE_URL = (process.env.SITE_URL || 'https://getrydja.com').replace(/\/+$/, '');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Secure cookies are the default in production. SECURE_COOKIES=0 is the escape
// hatch for the rare production host that terminates TLS somewhere we cannot
// see; setting it on a plain-HTTP site would stop you logging in.
const SECURE_COOKIES = process.env.SECURE_COOKIES
  ? process.env.SECURE_COOKIES === '1'
  : IS_PRODUCTION;

// Every managed host (Render, Fly, Railway) puts a proxy in front of the app.
// Without this, req.ip is the proxy's address — which would rate-limit every
// customer as if they were one person — and req.secure is always false.
const TRUST_PROXY = process.env.TRUST_PROXY || (IS_PRODUCTION ? '1' : '');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const SERVICES = [
  { slug: 'junk-hauling', name: 'Junk & Hauling', blurb: 'Furniture, appliances, household junk, scrap, debris and unwanted items.' },
  { slug: 'cleanout', name: 'Full Cleanouts', blurb: 'Garages, basements, barns, storage units, estates and rental turnovers.' },
  { slug: 'yard-cleanup', name: 'Yard Cleanup', blurb: 'Brush, branches, storm debris, leaves and outdoor clutter.' },
  { slug: 'moving-delivery', name: 'Moving & Delivery', blurb: 'Heavy lifting, Marketplace pickups, local delivery, labor-only moving help.' },
  { slug: 'light-demo', name: 'Light Demo', blurb: 'Small sheds, playsets, cabinets and similar tear-down-and-remove projects.' },
  { slug: 'other', name: 'Other Jobs', blurb: 'If it involves labor, a truck, cleanup or getting something handled, send it in.' }
];

const EXPENSE_CATEGORIES = [
  { value: 'dump', label: 'Dump / disposal fee' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'helper', label: 'Helper / labor' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'equipment', label: 'Equipment / rental' },
  { value: 'other', label: 'Other' }
];

const DISPOSITIONS = ['resell', 'scrap', 'donate', 'recycle', 'keep'];

const JOB_STATUSES = ['unscheduled', 'schedule_pending', 'scheduled', 'in_progress', 'complete', 'cancelled'];

// What the customer can ask for at intake. Preferences, not bookings -- none of
// these ever reaches jobs.scheduled_for.
const TIME_WINDOWS = [
  { value: 'morning', label: 'Morning', hint: '8am - 12pm' },
  { value: 'midday', label: 'Midday', hint: '11am - 2pm' },
  { value: 'afternoon', label: 'Afternoon', hint: '12pm - 5pm' },
  { value: 'evening', label: 'Evening', hint: 'after 5pm' },
  { value: 'flexible', label: 'Flexible', hint: 'any time that day' }
];
const WINDOW_LABELS = Object.fromEntries(TIME_WINDOWS.map((w) => [w.value, w.label]));

// ---------------------------------------------------------------- helpers

const money = (cents) =>
  (cents < 0 ? '-$' : '$') + (Math.abs(cents || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// "1,250.50" / "$1250" / "1250" -> 125050
function toCents(input) {
  const n = parseFloat(String(input == null ? '' : input).replace(/[^0-9.-]/g, ''));
  if (!isFinite(n)) return null;
  return Math.round(n * 100);
}

const nowIso = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

const FMT = { dateStyle: 'medium', timeStyle: 'short' };

// created_at / completed_at / responded_at are real UTC instants.
const prettyDate = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-US', FMT) : '');

// scheduled_for is wall-clock time the owner typed ("be there at 9"). It is
// stored and shown verbatim — no timezone shifting, so it reads the same
// whether the server runs here or in a UTC datacenter.
const prettyWhen = (s) => {
  if (!s) return '';
  const [date, time = '00:00'] = s.split(' ');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const dt = new Date(y, mo - 1, d, h, mi);
  return isNaN(dt) ? s : dt.toLocaleString('en-US', FMT);
};

const prettyStatus = (s) => String(s || '').replace(/_/g, ' ');

/**
 * A bare YYYY-MM-DD, as a person reads it: "Thursday, Oct 8".
 *
 * Built from the parts rather than parsed, because `new Date('2026-10-08')` is
 * UTC midnight and prints as the 7th for anyone west of Greenwich. A preferred
 * date is a day in the business's own calendar and has no time zone to convert.
 */
function prettyPrefDate(value) {
  const [y, m, d] = String(value || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) ? '' : dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * A date the customer could plausibly mean: a real calendar day, not in the
 * past, not more than a year out. Anything else is dropped rather than argued
 * about -- it is an optional preference, and refusing the whole lead over it
 * would be the worst possible trade.
 */
function cleanPrefDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (isNaN(dt) || dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const aYearOut = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
  if (dt < today || dt > aYearOut) return null;
  return raw;
}

const cleanWindow = (value) =>
  TIME_WINDOWS.some((w) => w.value === value) ? String(value) : null;

/**
 * Today, YYYY-MM-DD, in the server's own timezone -- the same clock the
 * business works to and the same one cleanPrefDate() validates against.
 *
 * Built from the local parts, not toISOString(), which is UTC and hands back
 * tomorrow's date all evening anywhere west of Greenwich. Used only as the
 * `min` on a date input, so the picker greys out the days the server would
 * drop anyway; it is a courtesy, not the validation.
 */
function todayLocal() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

/**
 * Where a job stands on scheduling, derived rather than stored -- the columns
 * already say it, and a sixth column to keep in step with them would be one
 * more thing to get wrong.
 *
 *   not_proposed     nothing offered yet
 *   awaiting         offered, customer has not answered
 *   change_requested customer asked for a different time
 *   confirmed        customer accepted; scheduled_for is set
 */
function scheduleState(job) {
  if (!job) return 'not_proposed';
  if (job.status === 'scheduled' && job.scheduled_for) return 'confirmed';
  if (job.schedule_message) return 'change_requested';
  if (job.proposed_for) return 'awaiting';
  return 'not_proposed';
}

const SCHEDULE_STATE_LABELS = {
  not_proposed: 'Not proposed',
  awaiting: 'Awaiting customer',
  change_requested: 'Change requested',
  confirmed: 'Confirmed'
};

/**
 * The dialable form of a phone number, for a tel: href. Display stays however
 * it was typed — "1-616-929-3360" reads better than "+16169293360" — but a
 * tel: URI holds digits and a leading + only, and the spaces and parentheses
 * we were emitting are not valid in one.
 *
 *   (616) 929-3360   -> +16169293360
 *   1-616-929-3360   -> +16169293360
 *   +44 20 7946 0000 -> +442079460000
 *
 * Anything that is not a recognisable North American number keeps its digits
 * and loses the + rather than being guessed at.
 */
function telHref(value) {
  const raw = String(value == null ? '' : value).trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return digits;
}

// ---------------------------------------------------------------- validation

/** Trim, collapse runs of whitespace, strip control characters, cap length. */
function clean(input, maxLen) {
  let out = '';
  for (const ch of String(input == null ? '' : input)) {
    const code = ch.codePointAt(0);
    // Drop control characters; keep newlines so descriptions stay readable.
    if (code === 127 || (code < 32 && code !== 10)) continue;
    out += ch;
  }
  return out.replace(/[^\S\n]+/g, ' ').trim().slice(0, maxLen);
}

/** Field length caps. Generous for humans, closed for junk. */
const LIMITS = {
  name: 80, phone: 25, email: 120, address: 120, city: 60,
  state: 30, zip: 12, service: 60, description: 4000, access: 60, timing: 40,
  note: 200, title: 120, notes: 2000, schedulingNote: 300, question: 1000
};

const digitsOnly = (s) => String(s).replace(/\D/g, '');

// 10-15 digits covers US/Canada and international without demanding a format.
const validPhone = (s) => {
  const d = digitsOnly(s);
  return d.length >= 10 && d.length <= 15;
};

// Deliberately loose: one @, something either side, a dot in the domain.
const validEmail = (s) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s) && s.length <= LIMITS.email;

// US 5-digit or ZIP+4. Also accepts a Canadian postal code so a border
// customer is not turned away.
const validZip = (s) => /^\d{5}(-\d{4})?$/.test(s) || /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(s);

/** Reject absurd money values from a typo or a tampered form. */
const MAX_CENTS = 100000000; // $1,000,000
const saneCents = (cents) => cents != null && Math.abs(cents) <= MAX_CENTS;

// ---------------------------------------------------------------- uploads

// The extension is derived from this allowlist, never from the uploaded
// filename, so nothing user-controlled reaches the filesystem path.
const ALLOWED_IMAGES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/pjpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif']
]);

/**
 * Content-Type is supplied by the client and can lie, so confirm the bytes on
 * disk really are an image. Without this, a .html file labelled image/png
 * would be stored and then served from our own origin as a script.
 */
function looksLikeImage(buf) {
  if (buf.length < 12) return false;
  const hex = buf.subarray(0, 12).toString('hex');
  const ascii = buf.subarray(0, 12).toString('latin1');

  if (hex.startsWith('ffd8ff')) return true;                         // JPEG
  if (hex.startsWith('89504e470d0a1a0a')) return true;               // PNG
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return true;
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return true;
  if (ascii.slice(4, 8) === 'ftyp') return true;                     // HEIC/HEIF
  return false;
}

/** Delete anything whose bytes are not actually an image; return the keepers. */
function keepOnlyRealImages(files) {
  const kept = [];
  for (const f of files || []) {
    let ok = false;
    try {
      const fd = fs.openSync(f.path, 'r');
      const head = Buffer.alloc(12);
      fs.readSync(fd, head, 0, 12, 0);
      fs.closeSync(fd);
      ok = looksLikeImage(head);
    } catch {
      ok = false;
    }
    if (ok) kept.push(f);
    else {
      console.warn('[upload] rejected non-image payload');
      fs.unlink(f.path, () => {});
    }
  }
  return kept;
}

/** Revenue - expenses + realized salvage. The only number that matters. */
function jobProfit(jobId) {
  const job = db.prepare('select customer_total_cents from jobs where id = ?').get(jobId);
  const revenue = job ? job.customer_total_cents : 0;

  const exp = db
    .prepare(
      `select coalesce(sum(amount_cents), 0) as total,
              coalesce(sum(case when category = 'dump' then amount_cents else 0 end), 0) as disposal,
              coalesce(sum(weight_lbs), 0) as weight
         from job_expenses where job_id = ?`
    )
    .get(jobId);

  const salvage = db
    .prepare(
      `select coalesce(sum(realized_value_cents), 0) as realized,
              coalesce(sum(case when realized_value_cents is null then estimated_value_cents else 0 end), 0) as pending
         from salvage_items where job_id = ?`
    )
    .get(jobId);

  return {
    revenue,
    expenses: exp.total,
    disposal: exp.disposal,
    weightLbs: exp.weight,
    salvageRealized: salvage.realized,
    salvagePending: salvage.pending,
    net: revenue - exp.total + salvage.realized
  };
}

// ---------------------------------------------------------------- app

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

// '1' = trust one proxy hop, which is what every managed host provides.
// Trusting blindly would let a client spoof X-Forwarded-For and dodge limits.
if (TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);

app.use(express.urlencoded({ extended: false, limit: '64kb' }));

app.use(
  cookieSession({
    name: 'ps_session',
    keys: [SESSION_SECRET],
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure: SECURE_COOKIES
  })
);

// Values every template can use. Registered before the static mounts so the
// 404/500 pages can still render when a static request is what failed.
app.use((req, res, next) => {
  res.locals.brand = BRAND;
  res.locals.tagline = TAGLINE;
  res.locals.siteUrl = SITE_URL;
  res.locals.businessPhone = PHONE;
  // Customer links and admin pages must never be indexed; the public marketing
  // pages should be. Each template overrides this where it differs.
  res.locals.noindex = false;
  res.locals.services = SERVICES;
  res.locals.money = money;
  res.locals.prettyDate = prettyDate;
  res.locals.prettyWhen = prettyWhen;
  res.locals.prettyStatus = prettyStatus;
  res.locals.telHref = telHref;
  res.locals.scheduleState = scheduleState;
  res.locals.prettyPrefDate = prettyPrefDate;
  res.locals.timeWindows = TIME_WINDOWS;
  res.locals.today = todayLocal();
  res.locals.assetV = ASSET_V;
  res.locals.windowLabels = WINDOW_LABELS;
  res.locals.scheduleStateLabels = SCHEDULE_STATE_LABELS;
  res.locals.isAdmin = Boolean(req.session && req.session.admin);
  next();
});

/**
 * A short content hash per static asset, computed once at boot.
 *
 * Every reference to a stylesheet or script carries it as ?v=, so a deploy can
 * never show a visitor the previous release's CSS -- which is exactly what a
 * revalidating browser or a CDN in front of this app will otherwise do. The
 * file name on disk never changes, so there is nothing to build and nothing to
 * clean up; the URL changes and the cache misses.
 */
function assetVersion(file) {
  try {
    const bytes = fs.readFileSync(path.join(__dirname, 'public', file));
    return crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 10);
  } catch {
    // Missing file is a deploy problem, not a reason to refuse to start. A
    // timestamp still busts the cache; the 404 will be obvious.
    return String(Date.now());
  }
}

const ASSET_V = {
  css: assetVersion('styles.css'),
  js: assetVersion('app.js'),
  // The hero art is referenced from the stylesheet, which cannot be templated,
  // so its URL is handed to CSS as a custom property in the page head. Without
  // that it would be the one asset that could still go stale on its own.
  hero: assetVersion('hero.svg')
};

/**
 * Cache hard, but only what is safe to.
 *
 * A URL carrying ?v= is immutable by construction: change the file and the
 * hash changes, so the URL changes with it. Everything else -- an asset a
 * stylesheet references by plain path, say -- must revalidate, or editing it
 * ships a change nobody can see until their cache expires. That is the exact
 * failure this whole pass exists to fix; it should not be reintroduced one
 * layer down.
 */
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => {
      const versioned = /[?&]v=/.test((res.req && res.req.originalUrl) || '');
      res.setHeader(
        'Cache-Control',
        versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate'
      );
    }
  })
);

// Photos. Filenames are random hex, so the URL is the capability — the
// customer can see their own job without an account. Hardening:
//   index:false    no directory listing, ever
//   dotfiles:deny  nothing hidden is reachable
//   nosniff        a stored file can never be re-interpreted as HTML/JS
//   CSP sandbox    even if one were, it executes nothing and reaches nothing
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    next();
  },
  express.static(UPLOAD_DIR, {
    maxAge: '7d',
    index: false,
    dotfiles: 'deny',
    fallthrough: false,
    setHeaders: (res) => res.setHeader('Content-Disposition', 'inline')
  })
);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      // The extension comes from our allowlist, never from the uploaded name,
      // so "photo.php" or "../../x" cannot influence the path we write to.
      const ext = ALLOWED_IMAGES.get(file.mimetype) || '.jpg';
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    }
  }),
  limits: {
    fileSize: 12 * 1024 * 1024, // 12 MB — a modern phone photo is 2-5 MB
    files: 12,
    fields: 30,
    parts: 50
  },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_IMAGES.has(file.mimetype))
});

// ---------------------------------------------------------------- limits
//
// Generous enough that a real customer never meets them: a household sending
// two jobs in a day, or the owner mistyping a password twice, sails through.

const quoteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  name: 'quote-form',
  onBlock: (req, res) =>
    res.status(429).render('quote', {
      service: '',
      values: {},
      stamp: formStamp(SESSION_SECRET),
      error:
        'That is several requests in a short time. Please wait a little, or call us directly to get this moving.'
    })
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  name: 'admin-login',
  onBlock: (req, res, retryAfter) =>
    res.status(429).render('admin/login', {
      error: `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`
    })
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin/login');
}

// ---------------------------------------------------------------- public

app.get('/', (req, res) => res.render('home'));

app.get('/services', (req, res) => res.render('services'));

app.get('/quote', (req, res) =>
  res.render('quote', {
    service: clean(req.query.service, LIMITS.service),
    error: null,
    values: {},
    stamp: formStamp(SESSION_SECRET)
  })
);

app.post('/quote', quoteLimiter, upload.array('photos', 12), (req, res) => {
  const b = req.body;

  // Bot filter, entire: the form must be one this server issued, and issued
  // recently. There is nothing else here a real customer can fail — no decoy
  // field for a password manager to fill in, no stopwatch on how fast they
  // type. What is left is the rate limiter, which is per-IP and generous.
  const stampState = checkStamp(b.form_stamp, SESSION_SECRET);
  if (stampState !== 'ok') {
    for (const file of req.files || []) fs.unlink(file.path, () => {});
    // Reason only. Never the customer's details, never the stamp itself.
    console.warn(`[spam] rejected submission from ${req.ip} (${stampState})`);

    // Neither case is the success page: nothing was saved, so nothing may
    // suggest it was. Both leave a working form and a way to reach us.
    return res.status(400).render('quote', {
      service: clean(b.service, LIMITS.service),
      values: b,
      stamp: formStamp(SESSION_SECRET),
      error:
        stampState === 'expired'
          ? 'This form was open for a while and timed out. Please re-send it — your details are still filled in.'
          : 'We could not accept that submission. Please reload this page and send it again, or call us directly.'
    });
  }

  const f = {
    name: clean(b.name, LIMITS.name),
    phone: clean(b.phone, LIMITS.phone),
    email: clean(b.email, LIMITS.email),
    zip: clean(b.zip, LIMITS.zip),
    address: clean(b.address, LIMITS.address),
    city: clean(b.city, LIMITS.city),
    state: clean(b.state, LIMITS.state),
    service: clean(b.service, LIMITS.service),
    description: clean(b.description, LIMITS.description),
    access: clean(b.access, LIMITS.access),
    timing: clean(b.timing, LIMITS.timing),
    // Optional throughout. A bad date is dropped, never a reason to refuse the
    // lead -- the job is the point, the preference is a courtesy.
    prefDate1: cleanPrefDate(b.preferred_date_1),
    prefWindow1: cleanWindow(b.preferred_window_1),
    prefDate2: cleanPrefDate(b.preferred_date_2),
    prefWindow2: cleanWindow(b.preferred_window_2),
    schedulingFlexible: b.scheduling_flexible ? 1 : 0,
    schedulingNote: clean(b.scheduling_note, LIMITS.schedulingNote)
  };

  const errors = [];
  if (!f.name) errors.push('your name');
  if (!f.phone) errors.push('a phone number');
  else if (!validPhone(f.phone)) errors.push('a valid phone number (10 digits)');
  if (!f.zip) errors.push('a ZIP code');
  else if (!validZip(f.zip)) errors.push('a valid ZIP code');
  if (!f.service) errors.push('a service');
  if (!f.description) errors.push('a description of the job');
  else if (f.description.length < 10) errors.push('a bit more detail in the description');
  if (f.email && !validEmail(f.email)) errors.push('a valid email address (or leave it blank)');

  let error = null;
  if (errors.length) error = 'Please include ' + errors.join(', ') + '.';
  else if (!b.hazard_ack) error = 'Please confirm the hazardous-material question so we can price the job.';

  if (error) {
    // Anything already written to disk for a rejected submission is removed
    // rather than left as an orphan.
    for (const file of req.files || []) fs.unlink(file.path, () => {});
    return res.status(400).render('quote', {
      service: f.service,
      values: Object.assign({}, b, f),
      stamp: formStamp(SESSION_SECRET),
      error
    });
  }

  const photos = keepOnlyRealImages(req.files);
  const phone = f.phone;

  const leadId = db.transaction(() => {
    let customer = db.prepare('select * from customers where phone = ?').get(phone);
    if (customer) {
      db.prepare('update customers set name = ?, email = coalesce(nullif(?, \'\'), email) where id = ?').run(
        f.name,
        f.email,
        customer.id
      );
    } else {
      const info = db
        .prepare('insert into customers (name, phone, email) values (?, ?, ?)')
        .run(f.name, phone, f.email || null);
      customer = { id: info.lastInsertRowid };
    }

    // Two separate identifiers, deliberately. public_token is the capability
    // that unlocks /q/:token and is secret; work_ref is the reference everyone
    // says out loud and grants nothing.
    const token = crypto.randomBytes(16).toString('hex');
    const lead = db
      .prepare(
        `insert into leads (customer_id, public_token, work_ref, service, description, address, city, state, zip,
                            access, timing, pref_date_1, pref_window_1, pref_date_2, pref_window_2,
                            scheduling_flexible, scheduling_note)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        customer.id,
        token,
        generateWorkRef(),
        f.service,
        f.description,
        f.address || null,
        f.city || null,
        f.state || null,
        f.zip,
        f.access || null,
        f.timing || null,
        f.prefDate1,
        f.prefDate1 ? f.prefWindow1 || 'flexible' : null,
        f.prefDate2,
        f.prefDate2 ? f.prefWindow2 || 'flexible' : null,
        f.schedulingFlexible,
        f.schedulingNote || null
      );

    const addPhoto = db.prepare('insert into lead_photos (lead_id, filename) values (?, ?)');
    for (const p of photos) addPhoto.run(lead.lastInsertRowid, p.filename);

    return lead.lastInsertRowid;
  })();

  // Reference, service and photo count. The work reference is public by
  // design, so it belongs in a log in a way a name or phone number never did.
  const { work_ref: workRef } = db.prepare('select work_ref from leads where id = ?').get(leadId);
  console.log(`[lead] new lead #${leadId} ${workRef} — ${f.service} — ${photos.length} photo(s)`);

  // The lead's private status URL (/q/:token) stays live and is what the
  // customer gets when a quote goes out. It is not what they land on here:
  // an empty status page reads like nothing happened, so the confirmation
  // page says plainly that the request arrived.
  res.redirect('/quote/sent');
});

// Confirmation for a request that was actually written. Nothing else redirects
// here — a rejected submission must never reach this page.
app.get('/quote/sent', (req, res) => res.render('quote-sent'));

// Customer's own job page: status, quote, approve/decline, before/after photos.
app.get('/q/:token', (req, res) => {
  const lead = db
    .prepare(
      `select l.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
         from leads l join customers c on c.id = l.customer_id
        where l.public_token = ?`
    )
    .get(req.params.token);
  if (!lead) return res.status(404).render('404');

  const quote = db.prepare('select * from quotes where lead_id = ? order by id desc limit 1').get(lead.id);
  const job = quote ? db.prepare('select * from jobs where quote_id = ?').get(quote.id) : null;
  const photos = job ? db.prepare('select * from job_photos where job_id = ? order by id').all(job.id) : [];

  res.render('customer-status', {
    lead,
    quote,
    job,
    photos,
    asked: req.query.asked === '1'
  });
});

/**
 * The customer answers the quote. Three ways to say yes:
 *
 *   approve          take the price; schedule later        -> unscheduled
 *   approve_confirm  take the price AND the proposed time  -> scheduled
 *   approve_change   take the price, not that time         -> schedule_pending
 *
 * All of it is one transaction, and the "is this quote still open?" check lives
 * inside it. A double-clicked Approve finds the quote already approved on the
 * second pass and changes nothing -- and if it somehow got that far, the unique
 * index on jobs(quote_id) refuses the second row outright.
 */
app.post('/q/:token/respond', (req, res) => {
  const lead = db.prepare('select * from leads where public_token = ?').get(req.params.token);
  if (!lead) return res.status(404).render('404');

  const decision = String(req.body.decision || '');
  const approvals = { approve: 'later', approve_confirm: 'confirm', approve_change: 'change' };
  const intent = approvals[decision];
  if (!intent && decision !== 'decline') return res.redirect('/q/' + lead.public_token);

  // Their reason for wanting a different time, if that is what they chose.
  const message = intent === 'change' ? clean(req.body.message, LIMITS.notes) : '';

  const outcome = db.transaction(() => {
    // Re-read inside the transaction: this is the check a second click races.
    const quote = db.prepare('select * from quotes where lead_id = ? order by id desc limit 1').get(lead.id);
    if (!quote || quote.status !== 'sent') return 'already_answered';

    db.prepare('update quotes set status = ?, responded_at = ? where id = ?').run(
      intent ? 'approved' : 'declined',
      nowIso(),
      quote.id
    );

    if (!intent) {
      db.prepare("update leads set status = 'declined' where id = ?").run(lead.id);
      return 'declined';
    }

    // Only a time the owner proposed can be confirmed, and only confirming it
    // fills scheduled_for. Nothing the customer typed at intake can reach here.
    const proposed = quote.proposed_for || null;
    const confirmed = intent === 'confirm' && proposed;

    const status = confirmed ? 'scheduled' : proposed ? 'schedule_pending' : 'unscheduled';

    db.prepare(
      `insert into jobs (lead_id, quote_id, operator_id, status, customer_total_cents,
                         scheduled_for, proposed_for, proposed_at, schedule_responded_at, schedule_message)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      lead.id,
      quote.id,
      ownerOperator().id,
      status,
      quote.amount_cents,
      confirmed ? proposed : null,
      proposed,
      proposed ? quote.created_at : null,
      proposed ? nowIso() : null,
      message || null
    );

    db.prepare("update leads set status = 'converted' where id = ?").run(lead.id);
    return confirmed ? 'scheduled' : status === 'schedule_pending' ? 'schedule_pending' : 'approved';
  })();

  // Reference and outcome only -- never the token, and never what they wrote.
  if (outcome !== 'already_answered') console.log(`[job] ${lead.work_ref} quote ${outcome} by customer`);
  res.redirect('/q/' + lead.public_token);
});

/** "Ask a question" -- saved on the lead for the owner to answer by phone. */
app.post('/q/:token/ask', (req, res) => {
  const lead = db.prepare('select id, public_token, work_ref from leads where public_token = ?').get(req.params.token);
  if (!lead) return res.status(404).render('404');

  const question = clean(req.body.question, LIMITS.question);
  if (!question) return res.redirect('/q/' + lead.public_token + '#ask');

  db.prepare('update leads set customer_message = ?, customer_message_at = ? where id = ?').run(
    question,
    nowIso(),
    lead.id
  );

  // The question is the customer's words; the owner reads it in the admin.
  console.log(`[question] ${lead.work_ref} asked a question`);
  res.redirect('/q/' + lead.public_token + '?asked=1#ask');
});

/**
 * The customer answers a proposed appointment. Accepting is the only thing
 * that books it; asking for another time leaves the offer open and hands the
 * owner a sentence to act on.
 */
app.post('/q/:token/schedule', (req, res) => {
  const lead = db.prepare('select * from leads where public_token = ?').get(req.params.token);
  if (!lead) return res.status(404).render('404');

  const job = db
    .prepare(
      `select j.* from jobs j
         join quotes q on q.id = j.quote_id
        where j.lead_id = ? order by j.id desc limit 1`
    )
    .get(lead.id);

  // Nothing to answer unless there is an open offer.
  if (!job || !job.proposed_for) return res.redirect('/q/' + lead.public_token);

  if (req.body.decision === 'accept') {
    db.prepare(
      `update jobs
          set scheduled_for = proposed_for, schedule_responded_at = ?,
              schedule_message = null, status = 'scheduled'
        where id = ?`
    ).run(nowIso(), job.id);
    console.log(`[schedule] ${lead.work_ref} confirmed by customer`);
    return res.redirect('/q/' + lead.public_token);
  }

  // Anything else is "not that time". The offer stays on the table, the job
  // stays schedule_pending, and scheduled_for is left alone.
  const message = clean(req.body.message, LIMITS.notes);
  if (!message) return res.redirect('/q/' + lead.public_token + '#appointment');

  db.prepare(
    `update jobs
        set schedule_message = ?, schedule_responded_at = ?, status = 'schedule_pending'
      where id = ?`
  ).run(message, nowIso(), job.id);

  // The message itself is the customer's words -- the owner reads it in the
  // admin, it does not go to a log file.
  console.log(`[schedule] ${lead.work_ref} change requested by customer`);
  res.redirect('/q/' + lead.public_token + '#appointment');
});

// ---------------------------------------------------------------- admin auth

app.get('/admin/login', (req, res) => res.render('admin/login', { error: null }));

/** Constant-time compare so response timing cannot leak the password. */
function passwordMatches(attempt) {
  const a = Buffer.from(crypto.createHash('sha256').update(String(attempt)).digest());
  const b = Buffer.from(crypto.createHash('sha256').update(ADMIN_PASSWORD).digest());
  return crypto.timingSafeEqual(a, b);
}

app.post('/admin/login', loginLimiter, (req, res) => {
  if (passwordMatches(req.body.password || '')) {
    // New session id on login so a pre-set cookie cannot be reused.
    const back = typeof req.session.returnTo === 'string' && req.session.returnTo.startsWith('/admin')
      ? req.session.returnTo
      : '/admin/leads';
    req.session = { admin: true };
    return res.redirect(back);
  }
  console.warn(`[auth] failed admin login from ${req.ip}`);
  res.status(401).render('admin/login', { error: 'Wrong password.' });
});

app.post('/admin/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

// ---------------------------------------------------------------- admin leads

app.get('/admin', requireAdmin, (req, res) => res.redirect('/admin/leads'));

app.get('/admin/leads', requireAdmin, (req, res) => {
  const leads = db
    .prepare(
      `select l.*, c.name as customer_name, c.phone as customer_phone,
              (select count(*) from lead_photos p where p.lead_id = l.id) as photo_count,
              (select amount_cents from quotes q where q.lead_id = l.id order by q.id desc limit 1) as quote_cents
         from leads l join customers c on c.id = l.customer_id
        order by case l.status when 'new' then 0 when 'quoted' then 1 else 2 end, l.id desc`
    )
    .all();

  const counts = {
    new: leads.filter((l) => l.status === 'new').length,
    quoted: leads.filter((l) => l.status === 'quoted').length,
    openJobs: db.prepare("select count(*) as n from jobs where status not in ('complete','cancelled')").get().n
  };

  res.render('admin/leads', { leads, counts });
});

app.get('/admin/leads/:id', requireAdmin, (req, res) => {
  const lead = db
    .prepare(
      `select l.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
         from leads l join customers c on c.id = l.customer_id where l.id = ?`
    )
    .get(req.params.id);
  if (!lead) return res.status(404).render('404');

  const photos = db.prepare('select * from lead_photos where lead_id = ? order by id').all(lead.id);
  const quote = db.prepare('select * from quotes where lead_id = ? order by id desc limit 1').get(lead.id);
  const job = quote ? db.prepare('select * from jobs where quote_id = ?').get(quote.id) : null;
  const history = db
    .prepare(
      `select l.id, l.service, l.created_at, l.status from leads l
        where l.customer_id = ? and l.id != ? order by l.id desc`
    )
    .all(lead.customer_id, lead.id);

  // Outcome of the email the last quote tried to send, so a delivery failure
  // is visible on the page and not only in the logs.
  const mailState = typeof req.query.mail === 'string' ? req.query.mail : null;

  res.render('admin/lead', { lead, photos, quote, job, history, mailState });
});

// Admin enters the quote by hand. Sending a new one replaces any unanswered quote.
app.post('/admin/leads/:id/quote', requireAdmin, async (req, res) => {
  const lead = db
    .prepare(
      `select l.id, l.public_token, l.work_ref, l.service,
              c.name as customer_name, c.email as customer_email
         from leads l join customers c on c.id = l.customer_id where l.id = ?`
    )
    .get(req.params.id);
  if (!lead) return res.status(404).render('404');

  const cents = toCents(req.body.amount);
  if (cents == null || cents <= 0 || !saneCents(cents)) {
    return res.redirect('/admin/leads/' + lead.id + '?error=amount');
  }

  const notes = clean(req.body.notes, LIMITS.notes) || null;

  // Optional. With one, the customer can agree to the price and the time in a
  // single click; without one, the quote behaves exactly as it always has.
  const proposedFor = String(req.body.proposed_for || '').trim().replace('T', ' ') || null;

  // A quote already on file means this one revises it, which changes how the
  // email reads. Read that before the write replaces it.
  const revised = Boolean(db.prepare('select id from quotes where lead_id = ? limit 1').get(lead.id));

  db.transaction(() => {
    db.prepare("delete from quotes where lead_id = ? and status = 'sent'").run(lead.id);
    db.prepare(
      "insert into quotes (lead_id, amount_cents, notes, proposed_for, status) values (?, ?, ?, ?, 'sent')"
    ).run(lead.id, cents, notes, proposedFor);
    db.prepare("update leads set status = 'quoted' where id = ?").run(lead.id);
  })();

  // The quote is saved. Everything below is delivery, and delivery cannot undo
  // it — the worst case is the owner texting the link by hand, exactly as they
  // did before this existed. sendQuoteEmail never throws and never rejects.
  const { ok, reason } = await mail.sendQuoteEmail({
    to: lead.customer_email,
    name: lead.customer_name,
    amountCents: cents,
    notes,
    token: lead.public_token,
    workRef: lead.work_ref,
    service: lead.service,
    proposedFor,
    revised
  });

  // Lead id and a fixed reason code only — never the address, name or token.
  // A deployment with no email configured is a choice, not a fault, so it is
  // not warned about on every single quote.
  if (ok) console.log(`[mail] quote email sent for ${lead.work_ref}`);
  else if (reason === 'no_email') console.log(`[mail] ${lead.work_ref} has no email on file — nothing sent`);
  else if (reason === 'not_configured')
    console.log(`[mail] email is off — nothing sent for ${lead.work_ref} (set RESEND_API_KEY and EMAIL_FROM)`);
  else console.warn(`[mail] quote email FAILED for ${lead.work_ref} (${reason}) — text the customer instead`);

  res.redirect('/admin/leads/' + lead.id + '?mail=' + (ok ? 'sent' : reason));
});

app.post('/admin/leads/:id/status', requireAdmin, (req, res) => {
  const allowed = ['new', 'quoted', 'declined'];
  if (allowed.includes(req.body.status)) {
    db.prepare('update leads set status = ? where id = ?').run(req.body.status, req.params.id);
  }
  res.redirect('/admin/leads/' + req.params.id);
});

// ---------------------------------------------------------------- admin jobs

app.get('/admin/jobs', requireAdmin, (req, res) => {
  const jobs = db
    .prepare(
      `select j.*, l.service, l.address, l.city, l.zip, l.public_token, l.work_ref,
              c.name as customer_name, c.phone as customer_phone, o.name as operator_name
         from jobs j
         join leads l on l.id = j.lead_id
         join customers c on c.id = l.customer_id
         join operators o on o.id = j.operator_id
        order by case j.status
                   when 'in_progress' then 0 when 'scheduled' then 1
                   when 'schedule_pending' then 2
                   when 'unscheduled' then 3 when 'complete' then 4 else 5 end,
                 coalesce(j.scheduled_for, j.created_at)`
    )
    .all();

  const board = jobs.map((j) => Object.assign({}, j, { profit: jobProfit(j.id) }));
  const totals = board.reduce(
    (acc, j) => {
      if (j.status === 'complete') {
        acc.revenue += j.profit.revenue;
        acc.net += j.profit.net;
        acc.done += 1;
      }
      return acc;
    },
    { revenue: 0, net: 0, done: 0 }
  );

  res.render('admin/jobs', { jobs: board, totals });
});

app.get('/admin/jobs/:id', requireAdmin, (req, res) => {
  const job = db
    .prepare(
      `select j.*, l.service, l.description, l.address, l.city, l.state, l.zip, l.access, l.timing,
              l.public_token, l.work_ref, l.id as lead_id,
              c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
              o.name as operator_name, q.notes as quote_notes
         from jobs j
         join leads l on l.id = j.lead_id
         join customers c on c.id = l.customer_id
         join operators o on o.id = j.operator_id
         join quotes q on q.id = j.quote_id
        where j.id = ?`
    )
    .get(req.params.id);
  if (!job) return res.status(404).render('404');

  res.render('admin/job', {
    job,
    expenses: db.prepare('select * from job_expenses where job_id = ? order by id').all(job.id),
    salvage: db.prepare('select * from salvage_items where job_id = ? order by id').all(job.id),
    photos: db.prepare('select * from job_photos where job_id = ? order by id').all(job.id),
    leadPhotos: db.prepare('select * from lead_photos where lead_id = ? order by id').all(job.lead_id),
    profit: jobProfit(job.id),
    expenseCategories: EXPENSE_CATEGORIES,
    dispositions: DISPOSITIONS,
    jobStatuses: JOB_STATUSES,
    // Outcome of the scheduling email the last proposal tried to send.
    scheduleMail: typeof req.query.schedule === 'string' ? req.query.schedule : null
  });
});

app.post('/admin/jobs/:id/status', requireAdmin, (req, res) => {
  const status = req.body.status;
  if (!JOB_STATUSES.includes(status)) return res.redirect('/admin/jobs/' + req.params.id);

  const sets = ['status = ?'];
  const args = [status];

  if (status === 'in_progress') sets.push('started_at = coalesce(started_at, ?)'), args.push(nowIso());
  if (status === 'complete') sets.push('completed_at = ?'), args.push(nowIso());
  if (status === 'scheduled' || status === 'unscheduled') sets.push('completed_at = null');

  args.push(req.params.id);
  db.prepare(`update jobs set ${sets.join(', ')} where id = ?`).run(...args);
  res.redirect('/admin/jobs/' + req.params.id);
});

// The owner offers a time; only the customer's acceptance books it. A second
// proposal replaces the first and clears whatever the customer said about it,
// so there is never more than one open offer to answer.
app.post('/admin/jobs/:id/propose', requireAdmin, async (req, res) => {
  const job = db
    .prepare(
      `select j.id, j.status, l.service, l.public_token, l.work_ref,
              c.name as customer_name, c.email as customer_email
         from jobs j
         join leads l on l.id = j.lead_id
         join customers c on c.id = l.customer_id
        where j.id = ?`
    )
    .get(req.params.id);
  if (!job) return res.status(404).render('404');

  const when = String(req.body.proposed_for || '').trim().replace('T', ' ');
  if (!when) return res.redirect('/admin/jobs/' + job.id + '?schedule=missing');

  db.prepare(
    `update jobs
        set proposed_for = ?, proposed_at = ?,
            schedule_message = null, schedule_responded_at = null,
            status = case when status in ('unscheduled', 'schedule_pending', 'scheduled')
                          then 'schedule_pending' else status end
      where id = ?`
  ).run(when, nowIso(), job.id);

  // Saved. Delivery comes after, and cannot undo it.
  const { ok, reason } = await mail.sendScheduleEmail({
    to: job.customer_email,
    name: job.customer_name,
    workRef: job.work_ref,
    service: job.service,
    proposedFor: when,
    token: job.public_token
  });

  // Work reference and a reason code. Never the token, never the customer.
  if (ok) console.log(`[mail] schedule proposal sent for ${job.work_ref}`);
  else if (reason === 'no_email') console.log(`[mail] ${job.work_ref} has no email on file — nothing sent`);
  else if (reason === 'not_configured')
    console.log(`[mail] email is off — nothing sent for ${job.work_ref} (set RESEND_API_KEY and EMAIL_FROM)`);
  else console.warn(`[mail] schedule email FAILED for ${job.work_ref} (${reason}) — contact the customer directly`);

  res.redirect('/admin/jobs/' + job.id + '?schedule=' + (ok ? 'sent' : reason));
});

app.post('/admin/jobs/:id/expenses', requireAdmin, (req, res) => {
  const cents = toCents(req.body.amount);
  const category = EXPENSE_CATEGORIES.some((c) => c.value === req.body.category) ? req.body.category : 'other';
  const weight = parseFloat(req.body.weight_lbs);

  if (cents != null && cents !== 0 && saneCents(cents)) {
    db.prepare('insert into job_expenses (job_id, category, amount_cents, weight_lbs, note) values (?, ?, ?, ?, ?)').run(
      req.params.id,
      category,
      cents,
      isFinite(weight) && weight > 0 && weight < 1000000 ? weight : null,
      clean(req.body.note, LIMITS.note) || null
    );
  }
  res.redirect('/admin/jobs/' + req.params.id);
});

app.post('/admin/jobs/:id/expenses/:expenseId/delete', requireAdmin, (req, res) => {
  db.prepare('delete from job_expenses where id = ? and job_id = ?').run(req.params.expenseId, req.params.id);
  res.redirect('/admin/jobs/' + req.params.id);
});

app.post('/admin/jobs/:id/salvage', requireAdmin, (req, res) => {
  const title = clean(req.body.title, LIMITS.title);
  const est = toCents(req.body.estimated_value) || 0;
  if (title && saneCents(est)) {
    db.prepare(
      `insert into salvage_items (job_id, title, disposition, estimated_value_cents, notes)
       values (?, ?, ?, ?, ?)`
    ).run(
      req.params.id,
      title,
      DISPOSITIONS.includes(req.body.disposition) ? req.body.disposition : 'resell',
      Math.max(0, est),
      clean(req.body.notes, LIMITS.notes) || null
    );
  }
  res.redirect('/admin/jobs/' + req.params.id);
});

// Record what the item actually sold for. Blank clears it back to pending.
app.post('/admin/jobs/:id/salvage/:itemId', requireAdmin, (req, res) => {
  const raw = String(req.body.realized_value || '').trim();
  db.prepare('update salvage_items set realized_value_cents = ? where id = ? and job_id = ?').run(
    raw === '' ? null : toCents(raw) || 0,
    req.params.itemId,
    req.params.id
  );
  res.redirect('/admin/jobs/' + req.params.id);
});

app.post('/admin/jobs/:id/salvage/:itemId/delete', requireAdmin, (req, res) => {
  db.prepare('delete from salvage_items where id = ? and job_id = ?').run(req.params.itemId, req.params.id);
  res.redirect('/admin/jobs/' + req.params.id);
});

app.post('/admin/jobs/:id/photos', requireAdmin, upload.array('photos', 12), (req, res) => {
  const phase = req.body.phase === 'after' ? 'after' : 'before';
  const add = db.prepare('insert into job_photos (job_id, phase, filename) values (?, ?, ?)');
  for (const p of keepOnlyRealImages(req.files)) add.run(req.params.id, phase, p.filename);
  res.redirect('/admin/jobs/' + req.params.id);
});

app.post('/admin/jobs/:id/photos/:photoId/delete', requireAdmin, (req, res) => {
  const photo = db.prepare('select * from job_photos where id = ? and job_id = ?').get(req.params.photoId, req.params.id);
  if (photo) {
    db.prepare('delete from job_photos where id = ?').run(photo.id);
    fs.unlink(path.join(UPLOAD_DIR, photo.filename), () => {});
  }
  res.redirect('/admin/jobs/' + req.params.id);
});

// ---------------------------------------------------------------- errors

app.use((req, res) => res.status(404).render('404'));

app.use((err, req, res, next) => {
  // Anything serve-static refuses — missing file, dotfile, traversal attempt —
  // is a client error, not a server fault. Show the 404 page and leak nothing
  // about what is or is not on disk.
  const status = (err && (err.status || err.statusCode)) || 0;
  if (err && (err.code === 'ENOENT' || (status >= 400 && status < 500))) {
    return res.status(status === 404 || status === 403 ? 404 : status).render('404');
  }

  // Oversized or too-many photos: tell the customer instead of blowing up.
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'One of those photos is over 12 MB. Please send a smaller version.'
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'Please send at most 12 photos.'
          : 'Those photos could not be read. Please try again.';
    if (req.path === '/quote') {
      return res.status(400).render('quote', {
        service: '',
        values: req.body || {},
        stamp: formStamp(SESSION_SECRET),
        error: msg
      });
    }
    return res.status(400).render('500');
  }

  console.error(err);
  res.status(500).render('500');
});

app.listen(PORT, () => {
  console.log(`${BRAND} running on http://localhost:${PORT}  (admin: /admin/login)`);

  if (IS_PRODUCTION) {
    console.log(
      `[config] secure cookies: ${SECURE_COOKIES ? 'on' : 'OFF'} | ` +
      `trust proxy: ${TRUST_PROXY || 'off'} | ` +
      `off-site backup: ${configFromEnv() ? 'configured' : 'NOT CONFIGURED'}`
    );
  }

  if (process.env.BACKUP_DAILY !== '0') {
    const hour = Number(process.env.BACKUP_HOUR);
    scheduleBackup.start({
      runBackup,
      hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 3,
      stateFile: path.join(process.env.BACKUP_DIR || path.join(__dirname, 'backups'), '.last-run.json')
    });
  }
});
