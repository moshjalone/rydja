'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const multer = require('multer');

const { db, ownerOperator } = require('./db');

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
const BRAND = process.env.BRAND_NAME || 'WORKINGBRAND';
const PHONE = process.env.BUSINESS_PHONE || '';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const SECURE_COOKIES = process.env.SECURE_COOKIES === '1';

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

const JOB_STATUSES = ['unscheduled', 'scheduled', 'in_progress', 'complete', 'cancelled'];

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
  note: 200, title: 120, notes: 2000
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
  res.locals.businessPhone = PHONE;
  res.locals.services = SERVICES;
  res.locals.money = money;
  res.locals.prettyDate = prettyDate;
  res.locals.prettyWhen = prettyWhen;
  res.locals.prettyStatus = prettyStatus;
  res.locals.isAdmin = Boolean(req.session && req.session.admin);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

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

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin/login');
}

// ---------------------------------------------------------------- public

app.get('/', (req, res) => res.render('home'));

app.get('/services', (req, res) => res.render('services'));

app.get('/quote', (req, res) =>
  res.render('quote', { service: req.query.service || '', error: null, values: {} })
);

app.post('/quote', upload.array('photos', 12), (req, res) => {
  const b = req.body;

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
    timing: clean(b.timing, LIMITS.timing)
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
    return res.status(400).render('quote', { service: f.service, values: f, error });
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

    const token = crypto.randomBytes(16).toString('hex');
    const lead = db
      .prepare(
        `insert into leads (customer_id, public_token, service, description, address, city, state, zip, access, timing)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        customer.id,
        token,
        f.service,
        f.description,
        f.address || null,
        f.city || null,
        f.state || null,
        f.zip,
        f.access || null,
        f.timing || null
      );

    const addPhoto = db.prepare('insert into lead_photos (lead_id, filename) values (?, ?)');
    for (const p of photos) addPhoto.run(lead.lastInsertRowid, p.filename);

    return lead.lastInsertRowid;
  })();

  const lead = db.prepare('select public_token from leads where id = ?').get(leadId);
  console.log(`[lead] new lead #${leadId} — ${f.service} — ${f.name} ${phone} — ${photos.length} photo(s)`);
  res.redirect('/q/' + lead.public_token);
});

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

  res.render('customer-status', { lead, quote, job, photos });
});

app.post('/q/:token/respond', (req, res) => {
  const lead = db.prepare('select * from leads where public_token = ?').get(req.params.token);
  if (!lead) return res.status(404).render('404');

  const quote = db.prepare('select * from quotes where lead_id = ? order by id desc limit 1').get(lead.id);
  if (!quote || quote.status !== 'sent') return res.redirect('/q/' + lead.public_token);

  const approved = req.body.decision === 'approve';

  db.transaction(() => {
    db.prepare('update quotes set status = ?, responded_at = ? where id = ?').run(
      approved ? 'approved' : 'declined',
      nowIso(),
      quote.id
    );

    if (!approved) {
      db.prepare("update leads set status = 'declined' where id = ?").run(lead.id);
      return;
    }

    // Approved quote becomes a job, assigned to the owner operator.
    db.prepare(
      `insert into jobs (lead_id, quote_id, operator_id, status, customer_total_cents)
       values (?, ?, ?, 'unscheduled', ?)`
    ).run(lead.id, quote.id, ownerOperator().id, quote.amount_cents);

    db.prepare("update leads set status = 'converted' where id = ?").run(lead.id);
  })();

  if (approved) console.log(`[job] quote #${quote.id} approved — job created for lead #${lead.id}`);
  res.redirect('/q/' + lead.public_token);
});

// ---------------------------------------------------------------- admin auth

app.get('/admin/login', (req, res) => res.render('admin/login', { error: null }));

/** Constant-time compare so response timing cannot leak the password. */
function passwordMatches(attempt) {
  const a = Buffer.from(crypto.createHash('sha256').update(String(attempt)).digest());
  const b = Buffer.from(crypto.createHash('sha256').update(ADMIN_PASSWORD).digest());
  return crypto.timingSafeEqual(a, b);
}

app.post('/admin/login', (req, res) => {
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

  res.render('admin/lead', { lead, photos, quote, job, history });
});

// Admin enters the quote by hand. Sending a new one replaces any unanswered quote.
app.post('/admin/leads/:id/quote', requireAdmin, (req, res) => {
  const lead = db.prepare('select * from leads where id = ?').get(req.params.id);
  if (!lead) return res.status(404).render('404');

  const cents = toCents(req.body.amount);
  if (cents == null || cents <= 0 || !saneCents(cents)) {
    return res.redirect('/admin/leads/' + lead.id + '?error=amount');
  }

  db.transaction(() => {
    db.prepare("delete from quotes where lead_id = ? and status = 'sent'").run(lead.id);
    db.prepare('insert into quotes (lead_id, amount_cents, notes, status) values (?, ?, ?, \'sent\')').run(
      lead.id,
      cents,
      clean(req.body.notes, LIMITS.notes) || null
    );
    db.prepare("update leads set status = 'quoted' where id = ?").run(lead.id);
  })();

  res.redirect('/admin/leads/' + lead.id);
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
      `select j.*, l.service, l.address, l.city, l.zip, l.public_token,
              c.name as customer_name, c.phone as customer_phone, o.name as operator_name
         from jobs j
         join leads l on l.id = j.lead_id
         join customers c on c.id = l.customer_id
         join operators o on o.id = j.operator_id
        order by case j.status
                   when 'in_progress' then 0 when 'scheduled' then 1
                   when 'unscheduled' then 2 when 'complete' then 3 else 4 end,
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
              l.public_token, l.id as lead_id,
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
    jobStatuses: JOB_STATUSES
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

app.post('/admin/jobs/:id/schedule', requireAdmin, (req, res) => {
  const when = String(req.body.scheduled_for || '').trim();
  if (when) {
    db.prepare("update jobs set scheduled_for = ?, status = case when status = 'unscheduled' then 'scheduled' else status end where id = ?").run(
      when.replace('T', ' '),
      req.params.id
    );
  } else {
    db.prepare('update jobs set scheduled_for = null where id = ?').run(req.params.id);
  }
  res.redirect('/admin/jobs/' + req.params.id);
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
      return res.status(400).render('quote', { service: '', values: req.body || {}, error: msg });
    }
    return res.status(400).render('500');
  }

  console.error(err);
  res.status(500).render('500');
});

app.listen(PORT, () => {
  console.log(`${BRAND} running on http://localhost:${PORT}  (admin: /admin/login)`);
});
