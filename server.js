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
const { SERVICE_PAGES, servicePage } = require('./content/service-pages');
const attribution = require('./attribution');

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Positive number of days from an env var, or the default. */
const days = (value, fallback) => {
  const n = Number(value);
  return isFinite(n) && n > 0 ? n : fallback;
};

// Two cookies, two lifetimes, set apart on purpose.
//
// ADMIN_SESSION_DAYS is how long a sign-in lasts. It is a credential, so the
// number is a security decision and it is named here rather than inherited from
// whatever the attribution window happens to be. Shorten it freely; nothing
// about marketing depends on it.
//
// ATTRIBUTION_DAYS is how long we remember which link brought a visitor. It
// holds no authority and grants nothing, so it can afford to outlive a browser
// restart -- which it must, or a Facebook click on Monday earns nothing when
// they come back and book on Thursday.
const ADMIN_SESSION_DAYS = days(process.env.ADMIN_SESSION_DAYS, 30);
const ATTRIBUTION_DAYS = days(process.env.ATTRIBUTION_DAYS, 30);

// Every managed host (Render, Fly, Railway) puts a proxy in front of the app.
// Without this, req.ip is the proxy's address — which would rate-limit every
// customer as if they were one person — and req.secure is always false.
const TRUST_PROXY = process.env.TRUST_PROXY || (IS_PRODUCTION ? '1' : '');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Where we say we work. One source of truth: the page copy, the structured
// data and the meta description all read from here, so they cannot drift and
// nobody has to remember to update three places.
const SERVICE_AREA = (process.env.SERVICE_AREA || 'Lowell, Stanton and surrounding West Michigan communities').trim();
const SERVICE_AREA_PLACES = (process.env.SERVICE_AREA_PLACES || 'Lowell, Michigan|Stanton, Michigan|West Michigan')
  .split('|')
  .map((p) => p.trim())
  .filter(Boolean);

// The effective date of the Terms as currently published. Recorded against a
// quote at the moment it is approved, so there is a record of which version
// that customer actually saw. Bump it whenever the Terms change materially.
const TERMS_VERSION = '2026-10-06';

// Offered to a customer once their job is complete, and only if configured.
// No incentive, no filtering by how happy they seem, no automatic redirect --
// the link is simply there, the same for everyone.
const GOOGLE_REVIEW_URL = (process.env.GOOGLE_REVIEW_URL || '').trim();

// The one public email address. Everything a customer could reach us at --
// the legal pages, the structured data, the Reply-To on every email we send --
// resolves to this, so there is exactly one address to change and no way for
// the site to offer one address while the mail offers another.
//
// CONTACT_EMAIL is the old name for the same thing, honoured as a fallback so
// an environment set before the rename keeps working. BUSINESS_EMAIL wins.
//
// Deliberately not OWNER_EMAIL: that one is the operator record, internal, and
// is not published anywhere.
const BUSINESS_EMAIL = (process.env.BUSINESS_EMAIL || process.env.CONTACT_EMAIL || '').trim();

// The social profiles we actually hold, each from the environment. There is no
// hardcoded fallback on purpose: an unset variable means the profile is not
// linked at all, rather than the site publishing a URL nobody checked.
//
// Both are normalised before they are published, because a URL copied out of a
// platform's share sheet carries a click-tracking parameter -- Facebook's
// `mibextid`, Instagram's `igsh`. Putting that in an href, or in sameAs, on a
// site whose privacy policy says it runs no tracking would be a small lie, and
// the profile resolves the same without it.
const SOCIAL_TRACKING_PARAMS = [/^mibextid$/, /^fbclid$/, /^igsh(id)?$/, /^rdid$/, /^utm_/];

/**
 * A social profile URL fit to publish, or '' if there is nothing to link.
 *
 * Anything that is not an https URL returns '' rather than being passed
 * through: a malformed or `javascript:` value in the environment should drop
 * the link, never put a broken or dangerous href in front of a visitor.
 */
function socialUrl(raw) {
  const value = (raw || '').trim();
  if (!value) return '';
  let url;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  for (const key of [...url.searchParams.keys()]) {
    if (SOCIAL_TRACKING_PARAMS.some((re) => re.test(key))) url.searchParams.delete(key);
  }
  return url.toString();
}

const FACEBOOK_URL = socialUrl(process.env.FACEBOOK_URL);
const INSTAGRAM_URL = socialUrl(process.env.INSTAGRAM_URL);

// Social profiles that are genuinely ours, for schema.org sameAs. Only real,
// verified accounts belong here, and each appears exactly once however many
// places on the site link to it.
const SAME_AS = [...new Set([FACEBOOK_URL, INSTAGRAM_URL].filter(Boolean))];

/**
 * Real finished jobs, for a future "Recent Work" section.
 *
 * Empty on purpose. The shape is here so that publishing the first one is a
 * data change rather than a build, but nothing invented goes in it: entries
 * come from work actually done, with the customer's agreement to publish.
 *
 * { service, community, summary, beforePhoto, afterPhoto, completedOn }
 */
const RECENT_WORK = [];

const SERVICES = [
  {
    slug: 'estate-cleanout',
    name: 'Estate & Whole-Property Cleanouts',
    blurb:
      'One room or an entire property. House, garage, basement, barn and outbuildings cleared, at the pace the family needs.',
    href: '/estate-cleanouts',
    // What the card's "get a quote" link prefills. A card's name is marketing
    // copy; the form's option is a stored value, and they are allowed to differ.
    quote: 'Estate / whole-property cleanout',
    flagship: true
  },
  { slug: 'junk-hauling', name: 'Junk & Hauling', blurb: 'Furniture, appliances, household junk, scrap, debris and unwanted items.' },
  { slug: 'cleanout', name: 'Full Cleanouts', blurb: 'Garages, basements, barns, storage units and rental turnovers.' },
  { slug: 'yard-cleanup', name: 'Yard Cleanup', blurb: 'Brush, branches, storm debris, leaves and outdoor clutter.' },
  { slug: 'moving-delivery', name: 'Moving & Delivery', blurb: 'Heavy lifting, Marketplace pickups, local delivery, labor-only moving help.' },
  { slug: 'light-demo', name: 'Light Demo', blurb: 'Small sheds, playsets, cabinets and similar tear-down-and-remove projects.' },
  { slug: 'other', name: 'Other Jobs', blurb: 'If it involves labor, a truck, cleanup or getting something handled, send it in.' }
];

// The work we actually do, in the words a customer would type. Drives the
// services page copy and the structured data's knowsAbout, so the page and the
// markup always agree.
const SERVICE_KEYWORDS = [
  'estate cleanouts',
  'whole house cleanouts',
  'inherited home cleanouts',
  'property cleanouts',
  'downsizing help',
  'junk removal',
  'garage cleanouts',
  'basement cleanouts',
  'barn cleanouts',
  'storage unit cleanouts',
  'rental and property cleanouts',
  'yard cleanup',
  'brush and debris removal',
  'furniture removal',
  'appliance removal',
  'moving help',
  'delivery help',
  'light demolition',
  'scrap pickup',
  'property resets'
];

// The exact label for the flagship service, named once. Everything that has
// to recognise an estate lead -- the conditional fields, the admin badge, the
// front-end toggle -- compares against this and nothing else.
const ESTATE_SERVICE = 'Estate / whole-property cleanout';

const QUOTE_SERVICES = [
  ESTATE_SERVICE,
  'Junk / hauling',
  'Garage / basement cleanout',
  'Storage unit cleanout',
  'Rental / property turnover',
  'Yard / brush cleanup',
  'Furniture / appliance removal',
  'Moving / delivery help',
  'Light demolition',
  'Other'
];

/**
 * Is this lead an estate / whole-property job?
 *
 * Deliberately exact rather than a /estate/i test. 'Estate cleanout' was the
 * old label and leads still carry it, so it is listed too -- but a customer
 * typing the word into a description must not turn their lead into one.
 */
const LEGACY_ESTATE_SERVICES = ['Estate cleanout'];
const isEstateService = (service) =>
  service === ESTATE_SERVICE || LEGACY_ESTATE_SERVICES.includes(service);

// The extra questions an estate job gets asked, and the only answers accepted.
// Anything not on these lists is dropped rather than stored: these are fixed
// vocabularies, so a tampered form cannot write free text into them.
const ESTATE_AREAS = ['House', 'Garage', 'Basement', 'Attic', 'Barn', 'Shed/outbuildings', 'Yard', 'Other'];
const ESTATE_SCOPES = [
  'A few rooms',
  'Most of the house',
  'Whole house',
  'Whole property / multiple buildings',
  'Not sure'
];

/** The areas the customer ticked, in our order, joined for storage. */
function cleanEstateAreas(input) {
  const picked = new Set([].concat(input == null ? [] : input).map((v) => String(v)));
  const kept = ESTATE_AREAS.filter((a) => picked.has(a));
  return kept.length ? kept.join(', ') : null;
}

const cleanEstateScope = (input) => (ESTATE_SCOPES.includes(String(input)) ? String(input) : null);

// A CTA that prefills a service the form does not offer silently produces a
// lead labelled something nothing else recognises. Cheap to check, and a
// startup failure is far easier to notice than a quietly mislabelled lead.
for (const source of [...SERVICE_PAGES.map((p) => p.quoteService), ...SERVICES.map((s) => s.quote)]) {
  if (source && !QUOTE_SERVICES.includes(source)) {
    throw new Error(`"${source}" is prefilled somewhere but is not an option on the quote form`);
  }
}

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
  note: 200, title: 120, notes: 2000, schedulingNote: 300, question: 1000,
  estateDeadline: 200
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
    // Authenticated state only: an admin sign-in and where to send them back
    // to afterwards. Nothing public belongs in here -- see ps_attr below.
    name: 'ps_session',
    keys: [SESSION_SECRET],
    maxAge: ADMIN_SESSION_DAYS * DAY_MS,
    sameSite: 'lax',
    httpOnly: true,
    secure: SECURE_COOKIES
  })
);

/**
 * Remember which link brought this visitor.
 *
 * Deliberately the smallest thing that works: the campaign parameters already
 * in the URL, plus the referring host the browser sends anyway, in one signed
 * first-party cookie of its own. No script runs, no third party is contacted,
 * no identifier is minted, no timestamp is stored, and nothing follows anyone
 * off this site.
 *
 * First touch wins, permanently. A visitor who arrives on /junk-removal from an
 * ad and then clicks through to /quote is credited to the ad -- and so is the
 * same person coming back a fortnight later and typing the address in directly,
 * because the cookie is already there and is never rewritten. That is the whole
 * reason this cannot be done from the quote form alone.
 *
 * The cookie is written once and then left alone. Refreshing it on every page
 * view would slide its expiry forward and turn "thirty days from the click"
 * into "thirty days from whenever they last looked", which is a different
 * measurement and not the one being claimed.
 */
const ATTRIBUTABLE = /^\/(?!admin|q\/|uploads\/|api\/)[^.]*$/;

app.use((req, res, next) => {
  // GET only, public pages only, and never a request for a file. The admin's
  // own browsing and a customer's private page say nothing about marketing.
  if (req.method !== 'GET' || !ATTRIBUTABLE.test(req.path)) return next();

  // Already attributed? Then there is nothing to do, today or ever again.
  if (attribution.fromRequest(req, SESSION_SECRET)) return next();

  // Attribution used to live inside ps_session. Carry anything still there
  // across rather than relabelling a visitor who arrived before the split.
  const legacy = req.session && req.session.attr;
  const attr = legacy && typeof legacy === 'object' ? legacy : attribution.capture(req, SITE_URL);
  if (req.session && req.session.attr) delete req.session.attr;

  res.cookie(attribution.COOKIE_NAME, attribution.sign(attr, SESSION_SECRET), {
    maxAge: ATTRIBUTION_DAYS * DAY_MS,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIES
  });
  next();
});

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
  res.locals.imgVersion = imgVersion;
  res.locals.serviceArea = SERVICE_AREA;
  res.locals.serviceAreaPlaces = SERVICE_AREA_PLACES;
  res.locals.servicePages = SERVICE_PAGES;
  res.locals.facebookUrl = FACEBOOK_URL;
  res.locals.instagramUrl = INSTAGRAM_URL;
  res.locals.sourceLabel = attribution.sourceLabel;
  res.locals.termsVersion = TERMS_VERSION;
  res.locals.year = new Date().getFullYear();
  res.locals.businessEmail = BUSINESS_EMAIL;
  res.locals.serviceKeywords = SERVICE_KEYWORDS;
  res.locals.quoteServices = QUOTE_SERVICES;
  res.locals.estateService = ESTATE_SERVICE;
  res.locals.estateAreas = ESTATE_AREAS;
  res.locals.estateScopes = ESTATE_SCOPES;
  res.locals.isEstateService = isEstateService;
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

// Content hashes for images referenced from page data rather than from a
// template literal. Memoised, because a service page may name the same file
// twice and this reads bytes off disk.
const _imgVersions = new Map();
function imgVersion(file) {
  if (!_imgVersions.has(file)) _imgVersions.set(file, assetVersion(file));
  return _imgVersions.get(file);
}

const ASSET_V = {
  css: assetVersion('styles.css'),
  js: assetVersion('app.js'),
  // The icon set changes together, so one hash covers it. The share image gets
  // its own, because a social network caches it by URL and will keep serving
  // the old card until the URL changes.
  icons: assetVersion('favicon-32x32.png'),
  og: assetVersion('og-image.jpg'),
  img: assetVersion('img/rydja-truck-trailer.webp'),
  // The owner photograph needs its own hash. It used to share `img` with the
  // truck photo, which meant replacing the portrait left the ?v= untouched and
  // every browser and cache in the chain kept serving the previous one. A hash
  // has to cover the file it versions, or it is decoration.
  owner: assetVersion('img/josh-owner-rydja.webp'),
  // The hero art is referenced from the stylesheet, which cannot be templated,
  // so its URL is handed to CSS as a custom property in the page head. Without
  // that it would be the one asset that could still go stale on its own.
  hero: assetVersion('hero.svg'),
  rig: assetVersion('rig.svg')
};

/**
 * One canonical URL per page. Express serves /junk-removal and /junk-removal/
 * identically by default, which is two crawlable URLs for one page. The
 * canonical tag already points both at the same place, but a redirect means
 * Google never has to work that out, and the duplicate never gets crawled.
 */
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path.length > 1 && req.path.endsWith('/')) {
    return res.redirect(301, req.path.replace(/\/+$/, '') + req.originalUrl.slice(req.path.length));
  }
  next();
});

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
    setHeaders: (res, filePath) => {
      // Crawler files are never cached hard. A sitemap or a robots.txt held in
      // an edge cache for a year is a change you cannot retract, and these two
      // are the files you most want to be able to correct in a hurry.
      if (/[\\/](?:sitemap\.xml|robots\.txt)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, no-cache');
        // express.static labels .xml as bare application/xml. Legal -- a parser
        // falls back to the document's own declaration -- but the declaration
        // says UTF-8, so say it on the wire too and leave nothing to infer.
        // send() skips its own content-type once one is already set.
        if (filePath.endsWith('.xml')) res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return;
      }
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

// ------------------------------------------------- notifying ourselves
//
// The owner should not have to sit refreshing the admin to find out that
// something happened. Every customer-driven event that needs a human sends one
// email to BUSINESS_EMAIL.
//
// Three rules hold at every call site below, and the tests enforce them:
//
//   1. The database commit happens first and is never conditional on the mail.
//      sendBusinessNotification resolves rather than throwing, so a provider
//      outage cannot lose a lead, undo an approval or unbook a job.
//   2. The customer's private token never appears in one of these. The admin
//      link is the way in, and it asks for a password.
//   3. The log gets a reference and a reason code. Never a name, a number, an
//      address, a message, or anything the provider said back.

/**
 * Send one business notification, and absorb anything that goes wrong.
 *
 * @param {string} workRef  for the log line, the only identifier it carries
 * @param {object} parts    passed through to mail.sendBusinessNotification
 */
async function notifyBusiness(workRef, parts) {
  try {
    const { ok, reason } = await mail.sendBusinessNotification(parts);
    if (ok) return true;
    // not_configured is the ordinary state of a dev machine and of production
    // before the address was set. It is not a failure worth a warning.
    if (reason === 'not_configured') return false;
    console.warn(`[notify] ${workRef} — not sent (${reason})`);
    return false;
  } catch (err) {
    // sendBusinessNotification resolves rather than rejecting, so this should
    // be unreachable. It is here because the alternative to catching is a 500
    // served to a customer whose lead was already committed -- the work is
    // done, and they would be told it failed. A notification is never worth
    // that. The error name only: a message could quote data back.
    console.warn(`[notify] ${workRef} — not sent (threw: ${err?.name || 'Error'})`);
    return false;
  }
}

/** How a preferred date and window read in a notification. */
function prefLine(date, window) {
  const day = prettyPrefDate(date);
  if (!day) return '';
  const label = WINDOW_LABELS[window] || '';
  return label ? `${day} (${label})` : day;
}

// ---------------------------------------------------------------- SEO
//
// The public surface is the marketing pages and the legal pages. Everything
// else -- the customer's own page, the whole admin -- is private and carries
// noindex, which is the mechanism that actually keeps it out of an index.
//
// sitemap.xml and robots.txt are NOT generated here. They are literal files in
// public/, served by express.static. Search Console refused a dynamically
// generated sitemap that was correct by every external measurement, so the
// generator is gone: there is now one file, one response, nothing computed at
// request time, and nothing that can differ between a browser and a crawler.
// If a URL is added to the site, public/sitemap.xml is edited by hand and the
// test below fails until it matches.

// Credits for the licensed photographs on the service pages. Pexels does not
// require attribution for a downloaded photo, but its API guidelines ask for a
// visible link to Pexels and a credit to the photographer. One quiet page
// linked once from the footer satisfies that without labelling any photograph
// on the page it sits on.
//
// Our own photographs -- the owner, the truck -- are not listed as licensed.
const IMAGE_CREDITS = [
  {
    title: 'Labelled moving boxes and a sheeted armchair',
    creator: 'Ketut Subiyanto',
    creatorUrl: 'https://www.pexels.com/@ketut-subiyanto',
    sourceUrl: 'https://www.pexels.com/photo/4246119/'
  },
  {
    title: 'A cleared residential garage',
    creator: 'hi room',
    creatorUrl: 'https://www.pexels.com/@hi-room-631222799',
    sourceUrl: 'https://www.pexels.com/photo/17181949/'
  }
];

/**
 * Structured data for the homepage. Only facts we actually hold: no street
 * address, no opening hours, no price range, no ratings, no social profiles.
 * Inventing any of those is how a business ends up with a knowledge panel that
 * is wrong in public.
 */
function businessJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'HomeAndConstructionBusiness',
    '@id': SITE_URL + '/#business',
    name: BRAND,
    url: SITE_URL + '/',
    description:
      `Junk removal, cleanouts, hauling, yard cleanup, furniture and appliance removal, ` +
      `moving help and light demolition serving ${SERVICE_AREA}.`,
    image: SITE_URL + '/og-image.jpg',
    logo: SITE_URL + '/img/rydja-logo.jpg',
    areaServed: SERVICE_AREA_PLACES.map((name) => ({ '@type': 'Place', name })),
    knowsAbout: SERVICE_KEYWORDS,
    // The services we actually offer, each pointing at the page describing it.
    // Offers carry no price: we quote every job individually and inventing a
    // range would be a claim we cannot stand behind.
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: `${BRAND} services`,
      itemListElement: SERVICE_PAGES.map((p) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: p.nav, url: SITE_URL + '/' + p.slug }
      }))
    }
  };
  if (PHONE) data.telephone = PHONE;
  if (BUSINESS_EMAIL) data.email = BUSINESS_EMAIL;
  if (SAME_AS.length) data.sameAs = SAME_AS;
  return JSON.stringify(data);
}

/** Breadcrumbs for a second-level page. Home > Services > this page. */
function breadcrumbJsonLd(name, path) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: 'Services', item: SITE_URL + '/services' },
      { '@type': 'ListItem', position: 3, name, item: SITE_URL + path }
    ]
  });
}

/**
 * A Service page's own structured data. provider points back at the business
 * node rather than repeating it, which is what @id is for.
 */
function serviceJsonLd(page) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: page.h1,
    description: page.description,
    url: SITE_URL + '/' + page.slug,
    serviceType: page.nav,
    provider: { '@type': 'HomeAndConstructionBusiness', '@id': SITE_URL + '/#business', name: BRAND },
    areaServed: SERVICE_AREA_PLACES.map((name) => ({ '@type': 'Place', name }))
  });
}

// No app.get('/robots.txt') and no app.get('/sitemap.xml') live here on
// purpose. Both are static files under public/, and a route would shadow or
// race the file depending on middleware order. One path, one response.

app.get('/', (req, res) => res.render('home', { jsonLd: businessJsonLd() }));

app.get('/services', (req, res) => res.render('services'));

// Public and indexable on purpose: a customer should be able to read these
// before they hand over a photo of their garage.
// One layout, seven genuinely different pages. The content lives in
// content/service-pages.js so a page is a content change, not a template.
for (const page of SERVICE_PAGES) {
  app.get('/' + page.slug, (req, res) =>
    res.render('service-page', {
      page,
      jsonLd: serviceJsonLd(page),
      breadcrumbJsonLd: breadcrumbJsonLd(page.nav, '/' + page.slug)
    })
  );
}

app.get('/service-area', (req, res) =>
  res.render('service-area', { breadcrumbJsonLd: breadcrumbJsonLd('Service Area', '/service-area') })
);

app.get('/terms', (req, res) => res.render('legal/terms'));
app.get('/privacy', (req, res) => res.render('legal/privacy'));
app.get('/accessibility', (req, res) => res.render('legal/accessibility'));
app.get('/image-credits', (req, res) =>
  res.render('legal/image-credits', { credits: IMAGE_CREDITS }));

app.get('/quote', (req, res) =>
  res.render('quote', {
    service: clean(req.query.service, LIMITS.service),
    error: null,
    values: {},
    stamp: formStamp(SESSION_SECRET)
  })
);

app.post('/quote', quoteLimiter, upload.array('photos', 12), async (req, res) => {
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

  // The estate questions, and only for an estate job. A non-estate submission
  // that carried them anyway -- a stale form, a bot replaying fields -- writes
  // nulls, so the columns never describe a lead they do not belong to.
  const estate = isEstateService(f.service)
    ? {
        areas: cleanEstateAreas(b.estate_areas),
        scope: cleanEstateScope(b.estate_scope),
        deadline: clean(b.estate_deadline, LIMITS.estateDeadline) || null
      }
    : { areas: null, scope: null, deadline: null };

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
                            scheduling_flexible, scheduling_note,
                            estate_areas, estate_scope, estate_deadline,
                            ${attribution.LEAD_COLUMNS.join(', ')})
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ${attribution.LEAD_COLUMNS.map(() => '?').join(', ')})`
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
        f.schedulingNote || null,
        estate.areas,
        estate.scope,
        estate.deadline,
        // Whatever the visitor's first page recorded, however long ago. A
        // visitor we never saw writes nulls rather than a guessed 'direct'.
        ...attribution.leadValues(attribution.fromRequest(req, SESSION_SECRET))
      );

    const addPhoto = db.prepare('insert into lead_photos (lead_id, filename) values (?, ?)');
    for (const p of photos) addPhoto.run(lead.lastInsertRowid, p.filename);

    return lead.lastInsertRowid;
  })();

  // Reference, service and photo count. The work reference is public by
  // design, so it belongs in a log in a way a name or phone number never did.
  // The source bucket is one of six fixed words and identifies nobody, so it
  // belongs here the same way the reference does. The raw campaign values stay
  // out of the log: a campaign name is ours, but it is not worth a line.
  const { work_ref: workRef, source } = db
    .prepare('select work_ref, source from leads where id = ?')
    .get(leadId);
  console.log(
    `[lead] new lead #${leadId} ${workRef} — ${f.service} — ${photos.length} photo(s) — ${source || 'unknown'}`
  );

  // Committed above, in a transaction, before anything here runs. The lead is
  // safe whatever the provider does with the next few lines.
  await notifyBusiness(workRef, {
    title: 'New quote request',
    workRef,
    replyTo: f.email,
    rows: [
      ['Service', f.service],
      ['Name', f.name],
      ['Phone', f.phone],
      ['Email', f.email],
      ['Location', [f.city, f.state].filter(Boolean).join(', ') || f.zip],
      ['ZIP', f.zip],
      ['Access', f.access],
      ['Timing', f.timing],
      ['Preferred', prefLine(f.prefDate1, f.prefWindow1)],
      ['Also works', prefLine(f.prefDate2, f.prefWindow2)],
      ['Flexible', f.schedulingFlexible ? 'Yes' : ''],
      // Estate columns are null on every other kind of lead, so these three
      // rows simply disappear unless this is estate work.
      ['Estate areas', estate.areas],
      ['Estate scope', estate.scope],
      ['Estate deadline', estate.deadline],
      ['Photos', String(photos.length)],
      ['Source', source || 'unknown']
    ],
    blocks: [
      { heading: 'Description', body: f.description },
      { heading: 'Scheduling note', body: f.schedulingNote }
    ],
    adminPath: '/admin/leads/' + leadId,
    adminLabel: 'Open this lead'
  });

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
    asked: req.query.asked === '1',
    // Offered once the work is done, and only when a review URL is configured.
    // Shown to everyone whose job is complete, with no filtering and no
    // automatic redirect.
    reviewUrl: job && job.status === 'complete' ? GOOGLE_REVIEW_URL : ''
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
app.post('/q/:token/respond', async (req, res) => {
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

    // The acceptance record: what they agreed to, and which Terms were in front
    // of them when they did. A decline records no version -- nothing was accepted.
    db.prepare('update quotes set status = ?, responded_at = ?, terms_version = ? where id = ?').run(
      intent ? 'approved' : 'declined',
      nowIso(),
      intent ? TERMS_VERSION : null,
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

  // 'already_answered' is the second click of a double click: the transaction
  // above saw the quote was no longer 'sent' and changed nothing, so there is
  // nothing to announce. That check is the duplicate protection -- this just
  // reads its result.
  if (outcome !== 'already_answered') {
    const customer = db
      .prepare('select name, phone, email from customers where id = ?')
      .get(lead.customer_id);
    const job = db.prepare('select id, proposed_for from jobs where lead_id = ? order by id desc limit 1').get(lead.id);
    const quote = db.prepare('select amount_cents from quotes where lead_id = ? order by id desc limit 1').get(lead.id);

    // Four outcomes, four different things the owner has to do about it.
    const titles = {
      declined: 'Quote declined',
      scheduled: 'Appointment confirmed',
      schedule_pending: 'Customer requested a different time',
      approved: 'Quote approved'
    };
    const nextSteps = {
      declined: '',
      scheduled: 'Nothing to do — the time you proposed is booked.',
      schedule_pending: 'Propose another time.',
      approved: 'Approved with no time agreed. Propose one.'
    };

    await notifyBusiness(lead.work_ref, {
      title: titles[outcome],
      workRef: lead.work_ref,
      // A status event: replying to "quote declined" reaches nobody useful,
      // so Reply goes to us. The exception is the customer asking for another
      // time, which is a request and deserves an answer.
      replyTo: outcome === 'schedule_pending' ? customer?.email : '',
      rows: [
        ['Service', lead.service],
        ['Name', customer?.name],
        ['Phone', customer?.phone],
        ['Email', customer?.email],
        ['Amount', quote ? money(quote.amount_cents) : ''],
        ['Confirmed for', outcome === 'scheduled' ? prettyWhen(job?.proposed_for) : ''],
        ['Time offered', outcome === 'schedule_pending' ? prettyWhen(job?.proposed_for) : ''],
        ['Next step', nextSteps[outcome]]
      ],
      blocks: [{ heading: 'What they said', body: outcome === 'schedule_pending' ? message : '' }],
      // A declined quote never became a job, so the lead is the only thing
      // there is to open.
      adminPath: job && outcome !== 'declined' ? '/admin/jobs/' + job.id : '/admin/leads/' + lead.id,
      adminLabel: job && outcome !== 'declined' ? 'Open this job' : 'Open this lead'
    });
  }

  res.redirect('/q/' + lead.public_token);
});

/** "Ask a question" -- saved on the lead for the owner to answer by phone. */
app.post('/q/:token/ask', async (req, res) => {
  const lead = db
    .prepare(
      `select l.id, l.public_token, l.work_ref, l.customer_message,
              c.name as customer_name, c.phone as customer_phone, c.email as customer_email
         from leads l join customers c on c.id = l.customer_id
        where l.public_token = ?`
    )
    .get(req.params.token);
  if (!lead) return res.status(404).render('404');

  const question = clean(req.body.question, LIMITS.question);
  if (!question) return res.redirect('/q/' + lead.public_token + '#ask');

  // A resend of the same question -- a double click, a refreshed POST -- is
  // not a second question. The message is already stored and the owner has
  // already been told, so this writes nothing and sends nothing.
  const repeat = lead.customer_message === question;

  if (!repeat) {
    db.prepare('update leads set customer_message = ?, customer_message_at = ? where id = ?').run(
      question,
      nowIso(),
      lead.id
    );

    // The question is the customer's words; the owner reads it in the admin.
    console.log(`[question] ${lead.work_ref} asked a question`);

    await notifyBusiness(lead.work_ref, {
      title: 'Customer question',
      workRef: lead.work_ref,
      // They asked something, so Reply should reach them.
      replyTo: lead.customer_email,
      rows: [
        ['Name', lead.customer_name],
        ['Phone', lead.customer_phone],
        ['Email', lead.customer_email]
      ],
      blocks: [{ heading: 'Their question', body: question }],
      adminPath: '/admin/leads/' + lead.id,
      adminLabel: 'Open this lead'
    });
  }

  res.redirect('/q/' + lead.public_token + '?asked=1#ask');
});

/**
 * The customer answers a proposed appointment. Accepting is the only thing
 * that books it; asking for another time leaves the offer open and hands the
 * owner a sentence to act on.
 */
app.post('/q/:token/schedule', async (req, res) => {
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

  const customer = db.prepare('select name, phone, email from customers where id = ?').get(lead.customer_id);

  if (req.body.decision === 'accept') {
    // The guard is the where clause, not a read before it: a second click
    // races the first, and only one of them can match. Deliberately compared
    // against proposed_for rather than tested for null -- proposing a new
    // time leaves the old scheduled_for in place, and that customer must
    // still be able to accept.
    const { changes } = db
      .prepare(
        `update jobs
            set scheduled_for = proposed_for, schedule_responded_at = ?,
                schedule_message = null, status = 'scheduled'
          where id = ? and (scheduled_for is null or scheduled_for != proposed_for)`
      )
      .run(nowIso(), job.id);

    if (changes) {
      console.log(`[schedule] ${lead.work_ref} confirmed by customer`);
      await notifyBusiness(lead.work_ref, {
        title: 'Appointment confirmed',
        workRef: lead.work_ref,
        // A status event. Nothing is being asked of us.
        rows: [
          ['Service', lead.service],
          ['Name', customer?.name],
          ['Phone', customer?.phone],
          ['Confirmed for', prettyWhen(job.proposed_for)],
          ['Next step', 'Nothing to do — the time you proposed is booked.']
        ],
        adminPath: '/admin/jobs/' + job.id,
        adminLabel: 'Open this job'
      });
    }

    return res.redirect('/q/' + lead.public_token);
  }

  // Anything else is "not that time". The offer stays on the table, the job
  // stays schedule_pending, and scheduled_for is left alone.
  const message = clean(req.body.message, LIMITS.notes);
  if (!message) return res.redirect('/q/' + lead.public_token + '#appointment');

  // The same message again is the same message. An UPDATE would report a row
  // changed even where every value is identical, so this is checked rather
  // than inferred from the row count.
  const repeat = job.schedule_message === message && job.status === 'schedule_pending';

  if (!repeat) {
    db.prepare(
      `update jobs
          set schedule_message = ?, schedule_responded_at = ?, status = 'schedule_pending'
        where id = ?`
    ).run(message, nowIso(), job.id);

    // The message itself is the customer's words -- the owner reads it in the
    // admin, it does not go to a log file.
    console.log(`[schedule] ${lead.work_ref} change requested by customer`);

    await notifyBusiness(lead.work_ref, {
      title: 'Customer requested a different time',
      workRef: lead.work_ref,
      // They asked for something. Reply should reach them.
      replyTo: customer?.email,
      rows: [
        ['Service', lead.service],
        ['Name', customer?.name],
        ['Phone', customer?.phone],
        ['Email', customer?.email],
        ['Time offered', prettyWhen(job.proposed_for)],
        ['Next step', 'Propose another time.']
      ],
      blocks: [{ heading: 'What they said', body: message }],
      adminPath: '/admin/jobs/' + job.id,
      adminLabel: 'Open this job'
    });
  }

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

// ------------------------------------------------------------ admin dashboard

/**
 * The current calendar month, as the bounds each kind of column needs.
 *
 * Two clocks live in this database and mixing them quietly loses a day's work
 * at every month boundary. created_at / completed_at / responded_at are UTC
 * instants, so they get UTC bounds derived from the local month. scheduled_for
 * is wall-clock time the owner typed, so it gets plain local dates.
 */
function monthPeriod(now = new Date()) {
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const asUtc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const asLocalDate = (d) =>
    [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');

  return {
    utcStart: asUtc(first),
    utcEnd: asUtc(next),
    dateStart: asLocalDate(first),
    dateEnd: asLocalDate(next),
    label: now.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  };
}

/** The six buckets, in the order the owner reads them. */
const SOURCE_ORDER = ['google', 'facebook', 'bing', 'referral', 'direct', 'other'];

// ------------------------------------------------- searching, sorting, filtering
//
// Every list in the admin reads its query string through one of the two
// functions below. Nothing a visitor types reaches SQL as SQL: a sort is a key
// into a fixed table of ORDER BY clauses, a status has to be on a list we
// wrote, and everything else is a bound parameter.

/** Lead statuses the admin can filter and set. */
const LEAD_STATUSES = ['new', 'quoted', 'declined', 'converted'];

// Job statuses are JOB_STATUSES, declared with the rest of the job model above.

/** The service filter's own value for "any estate job", incl. the old label. */
const ESTATE_FILTER = '__estate__';

/**
 * ORDER BY clauses, by key. The keys are what appear in a URL; the SQL is
 * ours and is never built from input.
 */
const LEAD_SORTS = {
  smart: { label: 'Needs attention', sql: "case l.status when 'new' then 0 when 'quoted' then 1 else 2 end, l.id desc" },
  newest: { label: 'Newest first', sql: 'l.id desc' },
  oldest: { label: 'Oldest first', sql: 'l.id asc' },
  name: { label: 'Customer A–Z', sql: 'c.name collate nocase asc, l.id desc' },
  quote_high: { label: 'Quote, highest', sql: 'coalesce(quote_cents, -1) desc, l.id desc' },
  quote_low: { label: 'Quote, lowest', sql: 'coalesce(quote_cents, 999999999) asc, l.id desc' }
};

const JOB_SORTS = {
  smart: {
    label: 'Workflow order',
    sql: `case j.status when 'in_progress' then 0 when 'scheduled' then 1
                       when 'schedule_pending' then 2 when 'unscheduled' then 3
                       when 'complete' then 4 else 5 end,
          coalesce(j.scheduled_for, j.created_at)`
  },
  soonest: { label: 'Soonest first', sql: 'coalesce(j.scheduled_for, j.proposed_for, j.created_at) asc' },
  latest: { label: 'Latest first', sql: 'coalesce(j.scheduled_for, j.proposed_for, j.created_at) desc' },
  newest: { label: 'Newest job', sql: 'j.id desc' },
  name: { label: 'Customer A–Z', sql: 'c.name collate nocase asc, j.id desc' },
  // Revenue is a stored column; net is computed per job in JS and sorted after.
  revenue: { label: 'Revenue, highest', sql: 'j.customer_total_cents desc, j.id desc' },
  net: { label: 'Net, highest', sql: 'j.id desc', after: (a, b) => b.profit.net - a.profit.net }
};

// Archived rows exist but do not count. Every total, every counter and every
// money figure in the admin is filtered through one of these two, so a lead
// archived to tidy the inbox cannot quietly change what last month earned.
const LEAD_ACTIVE = 'archived_at is null';
const JOB_ACTIVE = 'archived_at is null and lead_id in (select id from leads where archived_at is null)';
const QUOTE_ACTIVE = 'lead_id in (select id from leads where archived_at is null)';

/** A LIKE pattern that treats the user's % and _ as literal characters. */
function likePattern(value) {
  return '%' + String(value).replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
}

/** One key from a fixed set, or the first key as the default. */
const pick = (value, allowed, fallback) =>
  allowed.includes(String(value || '')) ? String(value) : fallback;

/** The lead list's query string, cleaned into something safe to build SQL from. */
function leadFilters(query) {
  const q = clean(query.q, 120);
  return {
    q,
    like: likePattern(q),
    // The phone column is searched with its punctuation stripped, so the
    // needle has to lose its own too.
    likeDigits: q.replace(/\D/g, '') ? likePattern(q.replace(/\D/g, '')) : null,
    status: pick(query.status, LEAD_STATUSES, ''),
    service: pick(query.service, [ESTATE_FILTER, ...QUOTE_SERVICES], ''),
    source: pick(query.source, [...SOURCE_ORDER, 'unknown'], ''),
    sort: pick(query.sort, Object.keys(LEAD_SORTS), 'smart'),
    archived: query.view === 'archived',
    // Whether anything is narrowing the list, for the "clear" affordance.
    get active() {
      return Boolean(this.q || this.status || this.service || this.source);
    }
  };
}

/** The job list's query string, same contract. */
function jobFilters(query) {
  const q = clean(query.q, 120);
  return {
    q,
    like: likePattern(q),
    likeDigits: q.replace(/\D/g, '') ? likePattern(q.replace(/\D/g, '')) : null,
    status: pick(query.status, JOB_STATUSES, ''),
    sort: pick(query.sort, Object.keys(JOB_SORTS), 'smart'),
    archived: query.view === 'archived',
    get active() {
      return Boolean(this.q || this.status);
    }
  };
}

/** What a bulk action or an edit just did, for the banner at the top. */
function leadNotice(done, n) {
  const count = Math.max(0, Math.min(999, parseInt(n, 10) || 0));
  const plural = count === 1 ? '' : 's';
  const messages = {
    archived: `${count} lead${plural} archived.`,
    restored: `${count} lead${plural} restored.`,
    status: `Status changed on ${count} lead${plural}.`,
    saved: 'Changes saved.',
    nothing: 'Nothing was selected.'
  };
  return messages[String(done || '')] || '';
}

/** The same, for jobs. */
function jobNotice(done, n) {
  const count = Math.max(0, Math.min(999, parseInt(n, 10) || 0));
  const plural = count === 1 ? '' : 's';
  const messages = {
    archived: `${count} job${plural} archived.`,
    restored: `${count} job${plural} restored.`,
    status: `Status changed on ${count} job${plural}.`,
    saved: 'Changes saved.',
    nothing: 'Nothing was selected.'
  };
  return messages[String(done || '')] || '';
}

/**
 * The ids a bulk form submitted, as positive integers and nothing else.
 *
 * A checkbox group arrives as a string when one is ticked and an array when
 * several are. Anything that is not a plain id is dropped rather than
 * argued about -- the action then applies to the ids that were real.
 */
function selectedIds(input) {
  const raw = [].concat(input == null ? [] : input);
  const ids = raw
    .map((v) => parseInt(String(v), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  // Deduplicated, and capped so one request cannot ask for unbounded work.
  return [...new Set(ids)].slice(0, 500);
}

/** `?a=1&b=2` from a filter object, so a redirect lands back where you were. */
function filterQuery(f, extra = {}) {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.status) params.set('status', f.status);
  if (f.service) params.set('service', f.service);
  if (f.source) params.set('source', f.source);
  if (f.sort && f.sort !== 'smart') params.set('sort', f.sort);
  if (f.archived) params.set('view', 'archived');
  for (const [k, v] of Object.entries(extra)) if (v !== '' && v != null) params.set(k, String(v));
  const s = params.toString();
  return s ? '?' + s : '';
}

/**
 * Leads and approvals per source.
 *
 * A lead counts as converted once a quote on it has been approved -- that is
 * the moment money becomes likely, and it is the thing an ad is actually
 * buying. Rows with no leads at all are dropped rather than printed as a column
 * of zeroes, and a rate is only shown when there is a denominator to divide by:
 * "1 of 1, 100%" from a single click is noise dressed up as a number.
 */
function sourceBreakdown(period) {
  const rows = db
    .prepare(
      `select coalesce(l.source, '') as source,
              count(*) as leads,
              sum(case when exists (
                    select 1 from quotes q where q.lead_id = l.id and q.status = 'approved'
                  ) then 1 else 0 end) as approved
         from leads l
        where l.archived_at is null and l.created_at >= ? and l.created_at < ?
        group by coalesce(l.source, '')`
    )
    .all(period.utcStart, period.utcEnd);

  const bySource = new Map(rows.map((r) => [r.source, r]));
  const known = SOURCE_ORDER.filter((s) => bySource.has(s));
  // An unattributed lead is its own row, never folded into Direct or Other.
  const order = bySource.has('') ? [...known, ''] : known;

  return order.map((source) => {
    const row = bySource.get(source);
    const leads = row.leads;
    const approved = row.approved || 0;
    return {
      source,
      label: attribution.sourceLabel(source || null),
      leads,
      approved,
      // Guarded twice over: no row reaches here with leads === 0, and the
      // template still has to handle a null rather than print "NaN%".
      rate: leads > 0 ? Math.round((approved / leads) * 100) : null
    };
  });
}

/** The money for one month, over the jobs actually completed inside it. */
function monthMoney(period) {
  const row = db
    .prepare(
      `select coalesce(sum(j.customer_total_cents), 0) as revenue,
              coalesce((select sum(e.amount_cents) from job_expenses e
                         where e.job_id in (select id from jobs
                                             where ${JOB_ACTIVE} and status = 'complete'
                                               and completed_at >= ? and completed_at < ?)), 0) as expenses,
              coalesce((select sum(s.realized_value_cents) from salvage_items s
                         where s.job_id in (select id from jobs
                                             where ${JOB_ACTIVE} and status = 'complete'
                                               and completed_at >= ? and completed_at < ?)), 0) as salvage
         from jobs j
        where j.archived_at is null
          and j.lead_id in (select id from leads where archived_at is null)
          and j.status = 'complete' and j.completed_at >= ? and j.completed_at < ?`
    )
    .get(
      period.utcStart, period.utcEnd,
      period.utcStart, period.utcEnd,
      period.utcStart, period.utcEnd
    );

  return {
    revenue: row.revenue,
    expenses: row.expenses,
    salvage: row.salvage,
    // The same arithmetic jobProfit() does per job, so the dashboard and a job
    // page can never disagree about what a month was worth.
    net: row.revenue - row.expenses + row.salvage
  };
}

app.get('/admin/dashboard', requireAdmin, (req, res) => {
  const period = monthPeriod();
  const one = (sql, ...args) => db.prepare(sql).get(...args).n;

  const month = {
    leads: one(`select count(*) as n from leads where ${LEAD_ACTIVE} and created_at >= ? and created_at < ?`,
      period.utcStart, period.utcEnd),
    quotesSent: one(
      `select count(*) as n from quotes where ${QUOTE_ACTIVE} and created_at >= ? and created_at < ?`,
      period.utcStart, period.utcEnd),
    quotesApproved: one(
      `select count(*) as n from quotes
        where ${QUOTE_ACTIVE} and status = 'approved' and responded_at >= ? and responded_at < ?`,
      period.utcStart, period.utcEnd),
    // scheduled_for is wall clock, so this one is a date comparison.
    jobsScheduled: one(
      `select count(*) as n from jobs where ${JOB_ACTIVE} and scheduled_for >= ? and scheduled_for < ?`,
      period.dateStart, period.dateEnd),
    jobsCompleted: one(
      `select count(*) as n from jobs
        where ${JOB_ACTIVE} and status = 'complete' and completed_at >= ? and completed_at < ?`,
      period.utcStart, period.utcEnd)
  };

  // What is sitting still and waiting for the owner to do something. Counts
  // only -- no reminder emails, no automation, just the list.
  const attention = [
    {
      label: 'New leads without a quote',
      href: '/admin/leads',
      n: one(`select count(*) as n from leads l
               where l.archived_at is null and l.status = 'new'
                 and not exists (select 1 from quotes q where q.lead_id = l.id)`)
    },
    {
      label: 'Quotes awaiting an answer',
      href: '/admin/leads',
      n: one(`select count(*) as n from quotes
               where ${QUOTE_ACTIVE} and status = 'sent' and responded_at is null`)
    },
    {
      label: 'Approved jobs not yet scheduled',
      href: '/admin/jobs',
      n: one(`select count(*) as n from jobs where ${JOB_ACTIVE} and status = 'unscheduled'`)
    },
    {
      label: 'Schedule change requested',
      href: '/admin/jobs',
      n: one(`select count(*) as n from jobs
               where ${JOB_ACTIVE}
                 and schedule_message is not null and schedule_message != ''
                 and status not in ('complete', 'cancelled')`)
    },
    {
      label: 'Jobs in progress',
      href: '/admin/jobs',
      n: one(`select count(*) as n from jobs where ${JOB_ACTIVE} and status = 'in_progress'`)
    },
    {
      label: 'Completed jobs',
      href: '/admin/jobs',
      n: one(`select count(*) as n from jobs where ${JOB_ACTIVE} and status = 'complete'`)
    }
  ];

  res.render('admin/dashboard', {
    period,
    month,
    totals: monthMoney(period),
    sources: sourceBreakdown(period),
    attention
  });
});

// ---------------------------------------------------------------- admin leads

app.get('/admin', requireAdmin, (req, res) => res.redirect('/admin/dashboard'));

app.get('/admin/leads', requireAdmin, (req, res) => {
  const f = leadFilters(req.query);

  // Built as fragments rather than string-interpolated values: every piece of
  // the query below is either a constant chosen from a fixed list, or a '?'.
  const where = [f.archived ? 'l.archived_at is not null' : 'l.archived_at is null'];
  const params = [];

  if (f.status) {
    where.push('l.status = ?');
    params.push(f.status);
  }
  if (f.service === ESTATE_FILTER) {
    // Estate work under any of its labels, including the one leads taken
    // before the rename still carry.
    const labels = [ESTATE_SERVICE, ...LEGACY_ESTATE_SERVICES];
    where.push(`l.service in (${labels.map(() => '?').join(', ')})`);
    params.push(...labels);
  } else if (f.service) {
    where.push('l.service = ?');
    params.push(f.service);
  }
  if (f.source) {
    // 'unknown' is the absence of a source, not a value it can hold.
    if (f.source === 'unknown') where.push('(l.source is null or l.source = \'\')');
    else {
      where.push('l.source = ?');
      params.push(f.source);
    }
  }
  if (f.q) {
    // One box over everything the owner might have in their hand: a name, a
    // number read off a missed call, a reference from a text message.
    // Digits-only for the phone, so "(616) 555-0144" finds 6165550144.
    where.push(`(
      c.name like ? escape '\\' or c.email like ? escape '\\'
      or replace(replace(replace(replace(c.phone, ' ', ''), '-', ''), '(', ''), ')', '') like ? escape '\\'
      or l.work_ref like ? escape '\\' or l.city like ? escape '\\' or l.zip like ? escape '\\'
      or l.address like ? escape '\\'
    )`);
    params.push(f.like, f.like, f.likeDigits, f.like, f.like, f.like, f.like);
  }

  const leads = db
    .prepare(
      `select l.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
              (select count(*) from lead_photos p where p.lead_id = l.id) as photo_count,
              (select amount_cents from quotes q where q.lead_id = l.id order by q.id desc limit 1) as quote_cents,
              (select j.id from jobs j where j.lead_id = l.id order by j.id desc limit 1) as job_id
         from leads l join customers c on c.id = l.customer_id
        where ${where.join(' and ')}
        order by ${LEAD_SORTS[f.sort].sql}`
    )
    .all(...params);

  // Counts describe the whole active inbox, not the filtered view: they are
  // how the owner decides what to filter to, so narrowing the list must not
  // move them.
  const counts = db
    .prepare(
      `select
         (select count(*) from leads where status = 'new' and archived_at is null) as new,
         (select count(*) from leads where status = 'quoted' and archived_at is null) as quoted,
         (select count(*) from jobs j join leads l on l.id = j.lead_id
           where j.status not in ('complete','cancelled')
             and j.archived_at is null and l.archived_at is null) as openJobs,
         (select count(*) from leads where archived_at is not null) as archived`
    )
    .get();

  res.render('admin/leads', {
    leads,
    counts,
    f,
    sorts: LEAD_SORTS,
    statuses: LEAD_STATUSES,
    services: QUOTE_SERVICES,
    sources: SOURCE_ORDER,
    notice: leadNotice(req.query.done, req.query.n)
  });
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

// ------------------------------------------------- editing and bulk actions
//
// Nothing here deletes. "Archive" sets a timestamp, the lists read it, and
// every dashboard total ignores it -- a lead carries photos and a job carries
// expenses and salvage, and all of that is a record of money. Restoring is
// the same write in reverse.

/**
 * Edit a lead: the customer, the job details, the status, and the money.
 *
 * The money is the part to be careful with. Changing the amount of a quote
 * the customer has already approved rewrites what they agreed to, so the
 * form says so plainly and the original stays on the record: the acceptance
 * row keeps its responded_at and terms_version, and the note records what the
 * figure was before. The alternative -- silently overwriting the number a
 * customer said yes to -- is the one thing this must not do quietly.
 */
app.get('/admin/leads/:id/edit', requireAdmin, (req, res) => {
  const lead = db
    .prepare(
      `select l.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
         from leads l join customers c on c.id = l.customer_id where l.id = ?`
    )
    .get(req.params.id);
  if (!lead) return res.status(404).render('404');

  const quote = db.prepare('select * from quotes where lead_id = ? order by id desc limit 1').get(lead.id);
  res.render('admin/lead-edit', { lead, quote, error: null, values: null });
});

app.post('/admin/leads/:id/edit', requireAdmin, (req, res) => {
  const lead = db
    .prepare(
      `select l.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
         from leads l join customers c on c.id = l.customer_id where l.id = ?`
    )
    .get(req.params.id);
  if (!lead) return res.status(404).render('404');

  const quote = db.prepare('select * from quotes where lead_id = ? order by id desc limit 1').get(lead.id);
  const b = req.body;

  const f = {
    name: clean(b.name, LIMITS.name),
    phone: clean(b.phone, LIMITS.phone),
    email: clean(b.email, LIMITS.email),
    service: clean(b.service, LIMITS.service),
    address: clean(b.address, LIMITS.address),
    city: clean(b.city, LIMITS.city),
    state: clean(b.state, LIMITS.state),
    zip: clean(b.zip, LIMITS.zip),
    access: clean(b.access, LIMITS.access),
    timing: clean(b.timing, LIMITS.timing),
    description: clean(b.description, LIMITS.description),
    status: LEAD_STATUSES.includes(b.status) ? b.status : lead.status
  };

  // The same rules the public form applies. An admin typo is still a typo,
  // and a lead with no phone number is not a lead anyone can act on.
  const errors = [];
  if (!f.name) errors.push('a name');
  if (!f.phone) errors.push('a phone number');
  else if (!validPhone(f.phone)) errors.push('a valid phone number (10 digits)');
  if (!f.zip) errors.push('a ZIP code');
  else if (!validZip(f.zip)) errors.push('a valid ZIP code');
  if (!f.service) errors.push('a service');
  if (!f.description) errors.push('a description');
  if (f.email && !validEmail(f.email)) errors.push('a valid email address (or leave it blank)');

  // phone is the customers table's unique key, so moving a lead onto a number
  // another customer already holds would collide. Say so rather than throw.
  const clash = db.prepare('select id from customers where phone = ? and id != ?').get(f.phone, lead.customer_id);
  if (clash) errors.push('a phone number not already used by another customer');

  const amountRaw = String(b.amount == null ? '' : b.amount).trim();
  let amountCents = null;
  if (quote && amountRaw !== '') {
    amountCents = toCents(amountRaw);
    if (amountCents == null || !saneCents(amountCents) || amountCents <= 0) errors.push('a valid quote amount');
  }

  if (errors.length) {
    return res.status(400).render('admin/lead-edit', {
      lead,
      quote,
      values: Object.assign({}, lead, b, {
        customer_name: f.name,
        customer_phone: f.phone,
        customer_email: f.email
      }),
      error: 'Please give ' + errors.join(', ') + '.'
    });
  }

  db.transaction(() => {
    db.prepare('update customers set name = ?, phone = ?, email = ? where id = ?').run(
      f.name,
      f.phone,
      f.email || null,
      lead.customer_id
    );
    db.prepare(
      `update leads set service = ?, address = ?, city = ?, state = ?, zip = ?,
                        access = ?, timing = ?, description = ?, status = ?
        where id = ?`
    ).run(
      f.service,
      f.address || null,
      f.city || null,
      f.state || null,
      f.zip,
      f.access || null,
      f.timing || null,
      f.description,
      f.status,
      lead.id
    );

    if (quote && amountCents != null && amountCents !== quote.amount_cents) {
      const was = money(quote.amount_cents);
      db.prepare('update quotes set amount_cents = ? where id = ?').run(amountCents, quote.id);

      // An approved quote is a record of agreement. The figure can be
      // corrected, but what it used to be is appended to the notes rather
      // than lost, and responded_at / terms_version are left exactly as the
      // customer left them.
      if (quote.status === 'approved') {
        const stamp = `[Amount edited by admin ${nowIso()}: was ${was}]`;
        db.prepare('update quotes set notes = trim(coalesce(notes, \'\') || ? ) where id = ?').run(
          (quote.notes ? '\n\n' : '') + stamp,
          quote.id
        );
        console.log(`[edit] ${lead.work_ref} approved quote amount changed by admin`);
      }

      // A job quotes its own total at the moment it was created. Keep the two
      // in step, but never reopen a job that is already finished and paid.
      db.prepare(
        "update jobs set customer_total_cents = ? where quote_id = ? and status not in ('complete','cancelled')"
      ).run(amountCents, quote.id);
    }
  })();

  console.log(`[edit] lead #${lead.id} ${lead.work_ref} edited by admin`);
  res.redirect('/admin/leads/' + lead.id + '?done=saved');
});

/** Archive, restore, or set a status on everything that was ticked. */
app.post('/admin/leads/bulk', requireAdmin, (req, res) => {
  const f = leadFilters(req.body);
  const ids = selectedIds(req.body.ids);
  const action = String(req.body.action || '');
  const back = '/admin/leads' + filterQuery(f);

  if (!ids.length) return res.redirect(back + (back.includes('?') ? '&' : '?') + 'done=nothing');

  const marks = ids.map(() => '?').join(', ');
  let done = '';

  if (action === 'archive') {
    db.prepare(`update leads set archived_at = ? where id in (${marks}) and archived_at is null`).run(nowIso(), ...ids);
    done = 'archived';
  } else if (action === 'restore') {
    db.prepare(`update leads set archived_at = null where id in (${marks})`).run(...ids);
    done = 'restored';
  } else if (action.startsWith('status:')) {
    const status = action.slice('status:'.length);
    if (!LEAD_STATUSES.includes(status)) return res.redirect(back);
    db.prepare(`update leads set status = ? where id in (${marks})`).run(status, ...ids);
    done = 'status';
  } else {
    return res.redirect(back);
  }

  console.log(`[bulk] ${done} ${ids.length} lead(s)`);
  res.redirect(back + (back.includes('?') ? '&' : '?') + 'done=' + done + '&n=' + ids.length);
});

// ---------------------------------------------------------------- admin jobs

app.get('/admin/jobs', requireAdmin, (req, res) => {
  const f = jobFilters(req.query);

  // A job is hidden by its own archive flag or by its lead's, so archiving a
  // lead takes its jobs off the board without a second write.
  const where = [f.archived ? '(j.archived_at is not null or l.archived_at is not null)' : 'j.archived_at is null and l.archived_at is null'];
  const params = [];

  if (f.status) {
    where.push('j.status = ?');
    params.push(f.status);
  }
  if (f.q) {
    where.push(`(
      c.name like ? escape '\\' or c.email like ? escape '\\'
      or replace(replace(replace(replace(c.phone, ' ', ''), '-', ''), '(', ''), ')', '') like ? escape '\\'
      or l.work_ref like ? escape '\\' or l.city like ? escape '\\' or l.zip like ? escape '\\'
      or l.address like ? escape '\\'
    )`);
    params.push(f.like, f.like, f.likeDigits, f.like, f.like, f.like, f.like);
  }

  const jobs = db
    .prepare(
      `select j.*, l.service, l.address, l.city, l.zip, l.public_token, l.work_ref,
              l.archived_at as lead_archived_at,
              c.name as customer_name, c.phone as customer_phone, o.name as operator_name
         from jobs j
         join leads l on l.id = j.lead_id
         join customers c on c.id = l.customer_id
         join operators o on o.id = j.operator_id
        where ${where.join(' and ')}
        order by ${JOB_SORTS[f.sort].sql}`
    )
    .all(...params);

  const board = jobs.map((j) => Object.assign({}, j, { profit: jobProfit(j.id) }));
  // Net is arithmetic over three tables rather than a column, so the one sort
  // that needs it happens here instead of in SQL.
  if (JOB_SORTS[f.sort].after) board.sort(JOB_SORTS[f.sort].after);

  // Totals follow the filtered view -- unlike the lead counts, these are a
  // readout of what is on screen, so filtering to one month or one status and
  // reading the money for it is the point.
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

  const archivedCount = db
    .prepare(
      `select count(*) as n from jobs j join leads l on l.id = j.lead_id
        where j.archived_at is not null or l.archived_at is not null`
    )
    .get().n;

  res.render('admin/jobs', {
    jobs: board,
    totals,
    f,
    sorts: JOB_SORTS,
    statuses: JOB_STATUSES,
    archivedCount,
    notice: jobNotice(req.query.done, req.query.n)
  });
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

/**
 * Edit a job: its status, the time, and the total.
 *
 * scheduled_for is normally set by the customer accepting an offer and by
 * nothing else, which is the rule the whole scheduling model rests on. This
 * form is the deliberate exception -- the phone call where they agree a time
 * with you directly -- so it is labelled as an override rather than presented
 * as the ordinary way to book something.
 */
app.get('/admin/jobs/:id/edit', requireAdmin, (req, res) => {
  const job = db
    .prepare(
      `select j.*, l.service, l.work_ref, c.name as customer_name, c.phone as customer_phone
         from jobs j join leads l on l.id = j.lead_id join customers c on c.id = l.customer_id
        where j.id = ?`
    )
    .get(req.params.id);
  if (!job) return res.status(404).render('404');

  res.render('admin/job-edit', { job, jobStatuses: JOB_STATUSES, error: null, values: null });
});

app.post('/admin/jobs/:id/edit', requireAdmin, (req, res) => {
  const job = db
    .prepare(
      `select j.*, l.service, l.work_ref, c.name as customer_name, c.phone as customer_phone
         from jobs j join leads l on l.id = j.lead_id join customers c on c.id = l.customer_id
        where j.id = ?`
    )
    .get(req.params.id);
  if (!job) return res.status(404).render('404');

  const b = req.body;
  const status = JOB_STATUSES.includes(b.status) ? b.status : job.status;
  const when = String(b.scheduled_for || '').trim().replace('T', ' ');
  const totalRaw = String(b.customer_total == null ? '' : b.customer_total).trim();

  const errors = [];
  const total = toCents(totalRaw);
  if (totalRaw === '' || total == null || !saneCents(total) || total <= 0) errors.push('a valid customer total');
  // Wall-clock, stored exactly as typed, same as everywhere else.
  if (when && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(when)) errors.push('a date and time, or nothing');

  if (errors.length) {
    return res.status(400).render('admin/job-edit', {
      job,
      jobStatuses: JOB_STATUSES,
      values: Object.assign({}, job, b),
      error: 'Please give ' + errors.join(', ') + '.'
    });
  }

  const sets = ['status = ?', 'customer_total_cents = ?', 'scheduled_for = ?'];
  const args = [status, total, when || null];

  // The same timestamp bookkeeping the status button does, so the two routes
  // cannot leave a job in states they disagree about.
  if (status === 'in_progress') sets.push('started_at = coalesce(started_at, ?)'), args.push(nowIso());
  if (status === 'complete') sets.push('completed_at = coalesce(completed_at, ?)'), args.push(nowIso());
  if (status === 'scheduled' || status === 'unscheduled') sets.push('completed_at = null');

  args.push(job.id);
  db.prepare(`update jobs set ${sets.join(', ')} where id = ?`).run(...args);

  console.log(`[edit] job #${job.id} ${job.work_ref} edited by admin`);
  res.redirect('/admin/jobs/' + job.id + '?done=saved');
});

/** Archive, restore, or set a status on everything that was ticked. */
app.post('/admin/jobs/bulk', requireAdmin, (req, res) => {
  const f = jobFilters(req.body);
  const ids = selectedIds(req.body.ids);
  const action = String(req.body.action || '');
  const back = '/admin/jobs' + filterQuery(f);

  if (!ids.length) return res.redirect(back + (back.includes('?') ? '&' : '?') + 'done=nothing');

  const marks = ids.map(() => '?').join(', ');
  let done = '';

  if (action === 'archive') {
    db.prepare(`update jobs set archived_at = ? where id in (${marks}) and archived_at is null`).run(nowIso(), ...ids);
    done = 'archived';
  } else if (action === 'restore') {
    // A job hidden only because its lead is archived cannot be restored from
    // here -- the lead is what is hiding it. Its own flag is cleared anyway,
    // so restoring the lead brings it straight back.
    db.prepare(`update jobs set archived_at = null where id in (${marks})`).run(...ids);
    done = 'restored';
  } else if (action.startsWith('status:')) {
    const status = action.slice('status:'.length);
    if (!JOB_STATUSES.includes(status)) return res.redirect(back);
    const stamp = nowIso();
    if (status === 'complete') {
      db.prepare(
        `update jobs set status = ?, completed_at = coalesce(completed_at, ?) where id in (${marks})`
      ).run(status, stamp, ...ids);
    } else if (status === 'in_progress') {
      db.prepare(
        `update jobs set status = ?, started_at = coalesce(started_at, ?) where id in (${marks})`
      ).run(status, stamp, ...ids);
    } else if (status === 'scheduled' || status === 'unscheduled') {
      db.prepare(`update jobs set status = ?, completed_at = null where id in (${marks})`).run(status, ...ids);
    } else {
      db.prepare(`update jobs set status = ? where id in (${marks})`).run(status, ...ids);
    }
    done = 'status';
  } else {
    return res.redirect(back);
  }

  console.log(`[bulk] ${done} ${ids.length} job(s)`);
  res.redirect(back + (back.includes('?') ? '&' : '?') + 'done=' + done + '&n=' + ids.length);
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
      // Printed apart so a change to one is never mistaken for the other.
      `admin session: ${ADMIN_SESSION_DAYS}d | attribution: ${ATTRIBUTION_DAYS}d | ` +
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
