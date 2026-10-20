'use strict';

// Visitor measurement, first-party and privacy-preserving.
//
// This exists to answer one question the business could not previously answer
// at all: when a month goes by with no leads, was that nobody arriving, or
// everybody arriving and leaving? Those have opposite fixes, and guessing
// which one you have is how a month gets spent on the wrong one.
//
// Everything here is ours. No Google Analytics, no Meta pixel, no third-party
// script, no network request to anybody. One table, one tiny endpoint, and a
// page of reporting inside the admin that already exists.
//
// ---------------------------------------------------------- what is NOT kept
//
// No cookie is set for any of this. No IP address is stored. No user-agent
// string is stored. Nothing about the page a visitor came from beyond its
// host, no query string, no screen size, no fingerprint, and nothing that can
// be joined to a person or followed to another site.
//
// A visit is counted with a *rotating* key: an HMAC over the IP and
// user-agent, salted with the server secret AND the calendar day. It is
// one-way, it is 16 hex characters, and because the day is inside the salt the
// same visitor returning tomorrow produces a completely different value. So
// "how many people came today" is answerable and "is this the same person as
// last week" is not -- by construction rather than by policy.
//
// That is the deliberate trade. It costs an accurate count of returning
// visitors, which this business does not need, and it buys an analytics system
// that holds no personal data worth protecting.
//
// ------------------------------------------------------------ who is counted
//
// Page views are recorded by the browser, not by the server, and the reason
// matters. A server counts every request, and a large share of requests to a
// small site are crawlers, scanners and link previewers. Counting those as
// visitors would inflate the one number the owner is trying to read, and
// inflate it in the direction of "we have traffic" -- the single most
// expensive wrong conclusion available here.
//
// So a view is recorded by a real browser that ran a script. That misses the
// few real people browsing with JavaScript off, which is a far smaller and far
// less misleading error than the alternative. The submission counter is
// recorded server-side, so the bottom of the funnel is exact either way.
//
// Crawlers are recorded too, separately, in their own table, because "has
// Googlebot actually been here" is a question with real consequences and no
// other first-party answer.

const crypto = require('crypto');

// ---------------------------------------------------------------- the events
//
// A closed set. The endpoint rejects anything not on this list rather than
// storing it, so no amount of traffic to it can fill the table with arbitrary
// strings, and a typo in the client script shows up as a missing number
// rather than as a new event nobody meant to create.

/** Events the browser may report. */
const CLIENT_EVENTS = new Set([
  'view',         // a public page was rendered in a real browser
  'quote_cta',    // a link or button leading to the quote form was clicked
  'form_start',   // the first field of the quote form was touched
  'photos_added', // photos were attached to the quote form
  'call_click',   // a tel: link was tapped
  'text_click'    // an sms: link was tapped
]);

/** Events only the server records. Never accepted from a browser. */
const SERVER_EVENTS = new Set([
  'quote_submit'  // a quote request was accepted and a lead created
]);

const EVENT_LABELS = {
  view: 'Page views',
  quote_cta: 'Quote button clicks',
  form_start: 'Quote forms started',
  photos_added: 'Photos attached',
  quote_submit: 'Quote requests sent',
  call_click: 'Call taps',
  text_click: 'Text taps'
};

// ---------------------------------------------------------------- the schema
//
// Created here rather than in schema.sql for the same reason the archived_at
// migrations live in db.js: an existing database reaches schema.sql having
// never heard of these tables, and the whole point is that a deploy carrying
// them cannot fail on a database that predates them.

const SCHEMA = `
create table if not exists visit_events (
  id         integer primary key autoincrement,
  name       text    not null,   -- one of CLIENT_EVENTS or SERVER_EVENTS
  path       text    not null,   -- a public path, never a query string
  visitor    text    not null,   -- day-rotating one-way key; see above
  day        text    not null,   -- YYYY-MM-DD in the business's local time
  source     text,               -- attribution bucket at the time of the event
  campaign   text,
  referrer   text,               -- host only, never a full URL
  created_at text    not null default (datetime('now'))
);
create index if not exists idx_visit_events_day  on visit_events(day);
create index if not exists idx_visit_events_name on visit_events(name, day);

create table if not exists crawler_visits (
  id         integer primary key autoincrement,
  bot        text    not null,   -- googlebot | bingbot | ... ; never a raw UA
  path       text    not null,
  status     integer not null,
  day        text    not null,
  created_at text    not null default (datetime('now'))
);
create index if not exists idx_crawler_visits_day on crawler_visits(day, bot);
`;

/** Create the analytics tables if they are not there. Safe on every boot. */
function migrate(db) {
  db.exec(SCHEMA);
}

// ---------------------------------------------------------------- crawlers
//
// Named crawlers only, matched against the user-agent. The point is not to
// catalogue every robot on the internet -- it is to be able to say "Googlebot
// fetched /junk-removal on the 14th and got a 200", which is the difference
// between knowing a page is reachable and hoping it is.
//
// Order matters: Googlebot's mobile user-agent also contains "Safari", and
// several of the AI crawlers contain "Chrome". Matching the distinctive token
// first is what keeps those from being mislabelled.

const CRAWLERS = [
  [/googlebot|google-inspectiontool|storebot-google/i, 'googlebot'],
  [/bingbot|adidxbot|bingpreview/i, 'bingbot'],
  [/applebot/i, 'applebot'],
  [/duckduckbot|duckduckgo-favicons/i, 'duckduckbot'],
  [/yandex(bot|images)/i, 'yandexbot'],
  [/baiduspider/i, 'baiduspider'],
  [/facebookexternalhit|facebookcatalog|meta-externalagent/i, 'facebook'],
  [/twitterbot/i, 'twitterbot'],
  [/linkedinbot/i, 'linkedinbot'],
  [/slackbot|discordbot|whatsapp|telegrambot/i, 'chat-preview'],
  [/ahrefsbot|semrushbot|mj12bot|dotbot|dataforseo|petalbot|seokicks|screaming frog/i, 'seo-tool'],
  [/gptbot|oai-searchbot|chatgpt-user|claudebot|claude-web|anthropic-ai|perplexitybot|ccbot|google-extended/i, 'ai-crawler'],
  [/uptimerobot|pingdom|statuscake|betteruptime|site24x7/i, 'uptime-monitor'],
  // Last, and loosest. Anything that calls itself a bot and is not one of the
  // above is still worth knowing about, under one honest label.
  [/bot\b|crawler|crawl|spider|slurp|scrapy|curl\/|wget|python-requests|headlesschrome|lighthouse|java\/|go-http-client|axios|node-fetch/i, 'other-bot']
];

/**
 * The crawler behind a user-agent, or null for anything that looks like a
 * person's browser.
 *
 * A missing user-agent counts as a bot. Every real browser sends one; a
 * request without one is automation that did not bother to pretend.
 */
function crawlerName(userAgent) {
  const ua = String(userAgent || '');
  if (!ua.trim()) return 'unidentified';
  for (const [pattern, name] of CRAWLERS) if (pattern.test(ua)) return name;
  return null;
}

// ---------------------------------------------------------------- visitor key

/**
 * The calendar day in the business's own local time, as YYYY-MM-DD.
 *
 * Local rather than UTC on purpose, and for the same reason the rest of this
 * app uses local days: the owner reads "yesterday" as the day he worked, and
 * in Michigan a UTC day boundary falls in the evening.
 */
function localDay(now = new Date()) {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
}

/**
 * An opaque, one-way, same-day-only key for one visitor.
 *
 * The day is inside the HMAC, not beside it, so the value cannot be recomputed
 * for a different day even by someone holding the secret and the IP -- which
 * is what makes it a counter rather than an identifier. 16 hex characters is
 * 64 bits: collisions are irrelevant at this scale, and the value is too short
 * to be useful for anything else.
 */
function visitorKey(ip, userAgent, secret, day = localDay()) {
  return crypto
    .createHmac('sha256', String(secret) + '|visit|' + day)
    .update(String(ip || '') + '|' + String(userAgent || ''))
    .digest('hex')
    .slice(0, 16);
}

// ---------------------------------------------------------------- recording

// Anything a terminal, a log line or an HTML attribute would treat as
// structure rather than text. The same rule attribution.js applies.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

/** Trim and cap, or null. Never undefined, never ''. */
function field(value, max = 120) {
  if (typeof value !== 'string') return null;
  const out = value.replace(CONTROL_CHARS, ' ').trim().slice(0, max);
  return out || null;
}

/**
 * A path fit to store: ours, absolute, no query string, no fragment.
 *
 * Anything else becomes '/other'. A browser reports the path it is on, and a
 * browser is something a visitor controls -- so this is a validator, not a
 * sanitiser. The set of paths the site actually has is passed in, which means
 * the table can only ever contain real pages plus one bucket.
 */
function safePath(value, known) {
  const raw = field(value, 200);
  if (!raw) return '/other';
  const path = raw.split('?')[0].split('#')[0];
  if (!path.startsWith('/')) return '/other';
  return known.has(path) ? path : '/other';
}

/**
 * Record one event. Never throws: analytics failing must never take down a
 * page view or, far worse, a quote submission.
 *
 * @param {object} db
 * @param {object} event  { name, path, visitor, day, source, campaign, referrer }
 */
function record(db, event) {
  try {
    db.prepare(
      `insert into visit_events (name, path, visitor, day, source, campaign, referrer)
       values (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.name,
      event.path,
      event.visitor,
      event.day || localDay(),
      field(event.source, 40),
      field(event.campaign),
      field(event.referrer, 120)
    );
    return true;
  } catch (err) {
    console.warn('[analytics] could not record ' + event.name + ': ' + err.message);
    return false;
  }
}

/** Record one crawler fetch. Same contract: never throws. */
function recordCrawl(db, { bot, path, status, day }) {
  try {
    db.prepare('insert into crawler_visits (bot, path, status, day) values (?, ?, ?, ?)').run(
      bot,
      path,
      Number(status) || 0,
      day || localDay()
    );
    return true;
  } catch (err) {
    console.warn('[analytics] could not record crawl: ' + err.message);
    return false;
  }
}

// ---------------------------------------------------------------- reporting
//
// Every query below is bounded by a day range the caller computed. Days are
// local-time strings and compare lexicographically, which is the whole reason
// the column is stored in that shape.

/** Totals per event name, plus unique visitors, for one day range. */
function summary(db, from, to) {
  const rows = db
    .prepare(
      `select name, count(*) as n, count(distinct visitor) as people
         from visit_events where day >= ? and day <= ? group by name`
    )
    .all(from, to);

  const byName = new Map(rows.map((r) => [r.name, r]));
  const counts = {};
  for (const name of [...CLIENT_EVENTS, ...SERVER_EVENTS]) {
    const row = byName.get(name);
    counts[name] = { events: row ? row.n : 0, people: row ? row.people : 0 };
  }

  // Unique visitors overall, which is not the sum of the per-event figures:
  // one person who views a page and taps Call appears in both.
  const people = db
    .prepare('select count(distinct visitor) as n from visit_events where day >= ? and day <= ?')
    .get(from, to).n;

  return { counts, people };
}

/**
 * The funnel, as steps with a conversion rate against the step above.
 *
 * Deliberately counts *people*, not events: five taps of the same Call button
 * is one person trying to reach us, and reading it as five would be flattering
 * and useless. A rate is only produced when the step above has somebody in it,
 * for the same reason the lead-source table refuses to print 100% off one
 * click.
 */
function funnel(db, from, to) {
  const { counts } = summary(db, from, to);
  const quotePageViews = db
    .prepare(
      `select count(distinct visitor) as n from visit_events
        where name = 'view' and path = '/quote' and day >= ? and day <= ?`
    )
    .get(from, to).n;

  const steps = [
    { key: 'visitors', label: 'Visitors', people: counts.view.people },
    { key: 'quote_cta', label: 'Clicked a quote button', people: counts.quote_cta.people },
    { key: 'quote_page', label: 'Reached the quote form', people: quotePageViews },
    { key: 'form_start', label: 'Started filling it in', people: counts.form_start.people },
    { key: 'quote_submit', label: 'Sent a quote request', people: counts.quote_submit.people }
  ];

  let previous = null;
  for (const step of steps) {
    step.rate = previous && previous > 0 ? Math.round((step.people / previous) * 100) : null;
    previous = step.people;
  }

  // Reaching a person by phone is a conversion too, and it is not on the path
  // above -- somebody who taps Call never sees the form. Reported beside the
  // funnel rather than inside it, because it is a different route to the same
  // outcome and folding it in would double-count the people who do both.
  const contact = {
    call: counts.call_click.people,
    text: counts.text_click.people,
    ofVisitors:
      counts.view.people > 0
        ? Math.round(((counts.call_click.people + counts.text_click.people) / counts.view.people) * 100)
        : null
  };

  return { steps, contact };
}

/** Page views and unique visitors per page, busiest first. */
function topPages(db, from, to, limit = 25) {
  return db
    .prepare(
      `select path, count(*) as views, count(distinct visitor) as people
         from visit_events
        where name = 'view' and day >= ? and day <= ?
        group by path order by people desc, views desc limit ?`
    )
    .all(from, to, limit);
}

/**
 * Where the visitors came from, by attribution bucket.
 *
 * Counts people rather than views, which is exact here: a visitor's source is
 * fixed for the whole of their visit by the attribution cookie they are
 * already carrying, so nobody appears under two sources on the same day.
 */
function trafficSources(db, from, to) {
  return db
    .prepare(
      `select coalesce(source, '') as source,
              count(distinct visitor) as people,
              count(*) as views
         from visit_events
        where name = 'view' and day >= ? and day <= ?
        group by coalesce(source, '') order by people desc`
    )
    .all(from, to);
}

/** Referring hosts, for the visits that had one. */
function referrers(db, from, to, limit = 15) {
  return db
    .prepare(
      `select referrer, count(distinct visitor) as people
         from visit_events
        where name = 'view' and referrer is not null and day >= ? and day <= ?
        group by referrer order by people desc limit ?`
    )
    .all(from, to, limit);
}

/** Visitors per day, oldest first -- the shape of a month. */
function daily(db, from, to) {
  return db
    .prepare(
      `select day, count(distinct visitor) as people, count(*) as views
         from visit_events where name = 'view' and day >= ? and day <= ?
        group by day order by day`
    )
    .all(from, to);
}

/**
 * Crawler activity: which bots came, how often, and when each was last seen.
 *
 * This is evidence of crawling and nothing more. A page Googlebot fetched is a
 * page Google has *seen*; whether it chose to index it is a separate fact that
 * only Search Console can tell you, and nothing here may be read as answering
 * it. The admin page says so in those words, on the page.
 */
function crawlerSummary(db, from, to) {
  return db
    .prepare(
      `select bot, count(*) as fetches, count(distinct path) as paths,
              max(created_at) as last_seen
         from crawler_visits where day >= ? and day <= ?
        group by bot order by fetches desc`
    )
    .all(from, to);
}

/** Which pages a named bot fetched, most recent first. */
function crawledPaths(db, from, to, bot, limit = 40) {
  return db
    .prepare(
      `select path, count(*) as fetches, max(created_at) as last_seen,
              max(status) as status
         from crawler_visits where day >= ? and day <= ? and bot = ?
        group by path order by last_seen desc limit ?`
    )
    .all(from, to, bot, limit);
}

/**
 * Delete events older than a cutoff day. Nothing calls this on a timer -- it
 * is here so that a retention decision is one line when the owner wants one,
 * rather than a schema change.
 */
function prune(db, beforeDay) {
  const a = db.prepare('delete from visit_events where day < ?').run(beforeDay).changes;
  const b = db.prepare('delete from crawler_visits where day < ?').run(beforeDay).changes;
  return a + b;
}

module.exports = {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  EVENT_LABELS,
  migrate,
  crawlerName,
  localDay,
  visitorKey,
  safePath,
  record,
  recordCrawl,
  summary,
  funnel,
  topPages,
  trafficSources,
  referrers,
  daily,
  crawlerSummary,
  crawledPaths,
  prune
};
