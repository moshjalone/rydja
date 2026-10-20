'use strict';

// Referral partners, and the record of actually talking to them.
//
// ------------------------------------------------------------------ the idea
//
// The highest-value work this business does -- a whole property emptied -- is
// almost never found by the person who needs it. It is found by somebody
// standing next to them: an estate-sale company that has just finished a sale
// and is looking at what nobody bought, a Realtor with a listing that cannot
// be photographed until the garage is empty, a property manager holding a unit
// a tenant left full, a storage facility about to auction an abandoned unit.
//
// Each of those people meets this problem several times a year and has to hand
// it to somebody. Being the somebody they hand it to is a lead source that
// costs nothing per lead, compounds rather than resetting every month, and
// belongs to RYDJA rather than to a platform that can reprice it.
//
// This file is the system for building that deliberately instead of by
// accident: who the candidates are, where each one came from, what was said
// and when, what the next step is, and -- the part nobody usually has -- which
// partners actually produced paying work.
//
// ------------------------------------------------------- what this is NOT
//
// It does not send anything. There is no outbound mail, no queue, no
// scheduler, no "sequence". It drafts a message and shows it to the owner,
// who reads it, edits it and sends it himself from his own mailbox, to one
// person at a time, because he has a reason to contact that person.
//
// That is a product decision and a legal one. Unsolicited bulk commercial
// email is regulated, cold outreach at volume is how a domain's reputation is
// destroyed, and a message a human has not read before sending is exactly the
// message that embarrasses a small local business in a small local market
// where everybody knows everybody. The draft exists to save the owner twenty
// minutes of writing, not to take him out of the loop.
//
// It also holds no data that was scraped. Every partner in here was entered by
// hand from something public and authorised -- a business's own website, its
// own public listing, a trade association's published member directory, a
// county or state register that exists to be read. `source_url` records where,
// so a year later there is an answer to "how do we know about these people".

const crypto = require('crypto');

// ---------------------------------------------------------------- the kinds
//
// Who is worth knowing, and why each one is a different conversation. The
// `why` is not decoration: it is what the outreach draft is built from, and a
// partner kind nobody can state a reason for does not belong on the list.

const KINDS = [
  {
    value: 'estate_sale',
    label: 'Estate sale company',
    short: 'Estate sale',
    // The single best fit, which is why it is first.
    why:
      'They finish a sale with a house still holding everything nobody bought, and the family wants it empty. ' +
      'They need a hauler the same week, every time, and it is the last thing on their job rather than the first.'
  },
  {
    value: 'realtor',
    label: 'Realtor / real estate agent',
    short: 'Realtor',
    why:
      'A listing cannot be photographed until the garage is empty, and a closing cannot happen with a basement ' +
      'full. They are on a deadline they did not set and they are judged on how fast the house went up.'
  },
  {
    value: 'property_manager',
    label: 'Property manager',
    short: 'Property mgr',
    why:
      'A tenant leaves and the unit has to be rentable again. It recurs on its own, it is predictable work, and ' +
      'it is the kind that comes in twos and threes in the same building.'
  },
  {
    value: 'storage_facility',
    label: 'Self-storage facility',
    short: 'Storage',
    why:
      'Abandoned units have to be cleared before they can be re-let, and the facility is not in the hauling ' +
      'business. The units are a known size, which makes the work easy to price and easy to repeat.'
  },
  {
    value: 'estate_attorney',
    label: 'Probate / estate attorney',
    short: 'Attorney',
    why:
      'Their client has just been appointed personal representative and has no idea who empties a house. A name ' +
      'they can hand over is worth something to them, and it has to be somebody who will not embarrass them.'
  },
  {
    value: 'auctioneer',
    label: 'Auctioneer / appraiser',
    short: 'Auctioneer',
    why:
      'They take what is worth selling and leave what is not, and somebody still has to deal with the rest. ' +
      'Their interests and ours do not overlap at all, which makes it an easy relationship.'
  },
  {
    value: 'senior_move',
    label: 'Senior move manager / downsizing',
    short: 'Senior move',
    why:
      'They move somebody into somewhere smaller, which by definition leaves things behind. Their customer is ' +
      'already stressed and a second vendor turning up badly reflects on them.'
  },
  {
    value: 'contractor',
    label: 'Contractor / remodeler',
    short: 'Contractor',
    why:
      'A remodel starts with a tear-out and ends with a pile. They would usually rather pay somebody to take it ' +
      'than put their own crew and their own truck on it.'
  },
  {
    value: 'cleaning',
    label: 'Cleaning / turnover service',
    short: 'Cleaning',
    why:
      'They cannot clean a room that is still full. They are frequently asked to do both and can only do one, ' +
      'which is the most natural referral there is.'
  },
  {
    value: 'nonprofit',
    label: 'Charity / donation centre',
    short: 'Nonprofit',
    why:
      'They take the good furniture and decline the rest, and the donor is left with the rest. It also works in ' +
      'our direction: anything genuinely worth donating out of a cleanout should go to them.'
  },
  {
    value: 'other',
    label: 'Other',
    short: 'Other',
    why: 'Worth knowing for a reason that does not fit the list above. Say what it is in the notes.'
  }
];

const KIND_VALUES = KINDS.map((k) => k.value);
const kind = (value) => KINDS.find((k) => k.value === value) || KINDS[KINDS.length - 1];

// ---------------------------------------------------------------- the stages
//
// Deliberately few. This is a record of a relationship, not a sales pipeline,
// and a stage nobody can define the difference between is a stage that gets
// set at random.

const STATUSES = [
  { value: 'prospect', label: 'Prospect', hint: 'Identified. Nobody has contacted them yet.' },
  { value: 'contacted', label: 'Contacted', hint: 'We have reached out and had no answer yet.' },
  { value: 'talking', label: 'Talking', hint: 'They answered. There is a conversation.' },
  { value: 'active', label: 'Active', hint: 'They have sent work, or agreed to.' },
  { value: 'declined', label: 'Not interested', hint: 'They said no. Recorded so nobody asks again.' },
  { value: 'dormant', label: 'Dormant', hint: 'Was active, has gone quiet.' }
];

const STATUS_VALUES = STATUSES.map((s) => s.value);
const statusLabel = (value) => (STATUSES.find((s) => s.value === value) || {}).label || value;

/** Stages where a follow-up is still worth chasing. */
const OPEN_STATUSES = ['prospect', 'contacted', 'talking', 'active'];

// ---------------------------------------------------------------- touches

const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone call' },
  { value: 'text', label: 'Text message' },
  { value: 'in_person', label: 'In person' },
  { value: 'mail', label: 'Post' },
  { value: 'form', label: 'Their website form' },
  { value: 'referral', label: 'They sent a job' }
];

const CHANNEL_VALUES = CHANNELS.map((c) => c.value);
const channelLabel = (value) => (CHANNELS.find((c) => c.value === value) || {}).label || value;

/** 'out' is us contacting them; 'in' is them contacting us. */
const DIRECTIONS = ['out', 'in'];

// ---------------------------------------------------------------- the schema
//
// Created here rather than in schema.sql, for the reason the analytics tables
// are: a database that predates this feature has to boot the deploy that
// introduces it.

const SCHEMA = `
create table if not exists partners (
  id            integer primary key autoincrement,
  name          text    not null,
  kind          text    not null default 'other',
  status        text    not null default 'prospect',
  city          text,
  contact_name  text,
  phone         text,
  email         text,
  website       text,
  -- Where we found them. A public listing, their own site, a published member
  -- directory, a county register. Recorded so that "how do we know about
  -- these people" has an answer a year later.
  source_url    text,
  source_note   text,
  -- The code in the link we hand them: getrydja.com/?ref=<code>. Unique, and
  -- not a secret -- it identifies a partner, grants nothing, and opens the
  -- homepage exactly as it would without it.
  referral_code text    unique,
  notes         text,
  -- A date, not a reminder. Nothing emails anybody; the admin lists what is
  -- due and the owner decides.
  next_step     text,
  next_step_on  text,
  created_at    text    not null default (datetime('now')),
  archived_at   text
);
create index if not exists idx_partners_status on partners(status);
create index if not exists idx_partners_code   on partners(referral_code);

create table if not exists partner_touches (
  id         integer primary key autoincrement,
  partner_id integer not null references partners(id),
  channel    text    not null,
  direction  text    not null default 'out',   -- out | in
  summary    text    not null,
  happened_on text,                            -- YYYY-MM-DD, as the owner says
  created_at text    not null default (datetime('now'))
);
create index if not exists idx_touches_partner on partner_touches(partner_id, created_at);
`;

function migrate(db) {
  db.exec(SCHEMA);
}

// ---------------------------------------------------------------- codes

// No vowels and no lookalikes: these get read aloud, written on the back of a
// card and typed in from a photograph. The same alphabet the work references
// use, for the same reason.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTWXYZ';
const CODE_LENGTH = 5;

/** The shape only. Says nothing about whether a code exists. */
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/**
 * A code nothing else is using.
 *
 * Retried rather than trusted: 29^5 is twenty million, so a collision is
 * vanishingly unlikely and a unique index would turn one into a 500 on the
 * one page where the owner is trying to add a partner.
 */
function uniqueCode(db) {
  const taken = db.prepare('select 1 as hit from partners where referral_code = ?');
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomCode();
    if (!taken.get(code)) return code;
  }
  throw new Error('could not mint a unique referral code');
}

/**
 * A `?ref=` value off a URL, normalised, or null.
 *
 * Case-insensitive and whitespace-tolerant, because this gets typed in by
 * hand off a business card. Anything that is not the right shape is null
 * rather than stored: a visitor controls this value, and a partner code that
 * matches nothing should read as "no partner", not as a partner called
 * something peculiar.
 */
function normalizeCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

// ---------------------------------------------------------------- queries

/** Partners, newest first, optionally filtered. */
function list(db, { status, kind: kindValue, q } = {}) {
  const where = ['archived_at is null'];
  const args = [];

  if (STATUS_VALUES.includes(status)) {
    where.push('status = ?');
    args.push(status);
  }
  if (KIND_VALUES.includes(kindValue)) {
    where.push('kind = ?');
    args.push(kindValue);
  }
  if (q) {
    // One LIKE across the fields somebody would actually search. The pattern
    // is escaped by the caller.
    where.push('(name like ? escape \'\\\' or city like ? escape \'\\\' or contact_name like ? escape \'\\\')');
    args.push(q, q, q);
  }

  return db
    .prepare(
      `select p.*,
              (select count(*) from partner_touches t where t.partner_id = p.id) as touches,
              (select max(created_at) from partner_touches t where t.partner_id = p.id) as last_touch,
              (select count(*) from leads l
                where l.referral_code = p.referral_code and l.archived_at is null) as leads
         from partners p
        where ${where.join(' and ')}
        order by case status
                   when 'active' then 0 when 'talking' then 1 when 'contacted' then 2
                   when 'prospect' then 3 when 'dormant' then 4 else 5 end,
                 p.name collate nocase`
    )
    .all(...args);
}

const get = (db, id) => db.prepare('select * from partners where id = ?').get(id);

const byCode = (db, code) =>
  code ? db.prepare('select * from partners where referral_code = ?').get(code) : undefined;

const touches = (db, partnerId) =>
  db
    .prepare('select * from partner_touches where partner_id = ? order by created_at desc, id desc')
    .all(partnerId);

/**
 * The leads a partner's link actually produced, and what came of them.
 *
 * This is the number the whole file exists for. An outreach system that cannot
 * tell you which partner produced paying work is a to-do list.
 */
function leadsFor(db, code) {
  if (!code) return [];
  return db
    .prepare(
      `select l.id, l.work_ref, l.service, l.status, l.created_at,
              (select amount_cents from quotes q where q.lead_id = l.id order by q.id desc limit 1) as amount_cents,
              exists (select 1 from quotes q where q.lead_id = l.id and q.status = 'approved') as approved
         from leads l
        where l.referral_code = ? and l.archived_at is null
        order by l.created_at desc`
    )
    .all(code);
}

/** What is overdue or due today, across every partner still worth chasing. */
function due(db, today) {
  return db
    .prepare(
      `select id, name, kind, status, next_step, next_step_on
         from partners
        where archived_at is null
          and next_step_on is not null and next_step_on != ''
          and next_step_on <= ?
          and status in (${OPEN_STATUSES.map(() => '?').join(', ')})
        order by next_step_on, name collate nocase`
    )
    .all(today, ...OPEN_STATUSES);
}

/** Counts per stage, for the top of the list page. */
function summary(db) {
  const rows = db
    .prepare('select status, count(*) as n from partners where archived_at is null group by status')
    .all();
  const by = new Map(rows.map((r) => [r.status, r.n]));
  return STATUSES.map((s) => ({ ...s, n: by.get(s.value) || 0 }));
}

// ---------------------------------------------------------------- outreach
//
// A draft, for a human to read, edit and send himself. Never sent from here.
//
// Written to be the opposite of a sales email: it says who we are, names the
// specific reason this particular kind of business would care, makes one small
// ask, and stops. No urgency, no flattery, no "I noticed your website", no
// follow-up threat, and nothing claiming a credential RYDJA has not verified.

/**
 * A first-contact draft for one partner.
 *
 * @param {object} partner
 * @param {object} business  { brand, phone, email, siteUrl, area, ownerName }
 */
function outreachDraft(partner, business) {
  const k = kind(partner.kind);
  const who = partner.contact_name ? partner.contact_name.split(/\s+/)[0] : 'there';
  const place = partner.city ? ` in ${partner.city}` : '';

  const subjects = {
    estate_sale: `Cleanout help after your sales${place}`,
    realtor: `Getting a listing empty and photographable${place}`,
    property_manager: `Unit turnovers${place} — clearing what tenants leave`,
    storage_facility: `Clearing abandoned units${place}`,
    estate_attorney: `A cleanout name for your personal representatives`,
    auctioneer: `What is left after the auction`,
    senior_move: `Clearing what does not come along on a downsize`,
    contractor: `Tear-out debris and haul-off${place}`,
    cleaning: `Clearing a unit before you clean it`,
    nonprofit: `Donations out of cleanouts, and clearing what you cannot take`,
    other: `${business.brand} — local cleanouts and hauling${place}`
  };

  // The one sentence that is about them rather than about us. This is the only
  // part of the message that earns a reply.
  const reasons = {
    estate_sale:
      'After a sale finishes you are usually left with a house that still has everything nobody bought in it, and a family who wants it empty. That is the part we do.',
    realtor:
      'When a listing cannot be photographed until the garage is empty, we are the people who empty the garage — usually within a few days, and with the sweep-up at the end.',
    property_manager:
      'When a tenant leaves a unit full, we clear it so it can be cleaned and re-let. If you have two in the same building, that is easier for us and cheaper for you.',
    storage_facility:
      'When a unit has to be cleared before it can be re-let, we clear it. Units are a known size, so we can usually price one off a photograph without coming out first.',
    estate_attorney:
      'Your clients get appointed personal representative and then discover they have a house to empty. We do that part, we write the price down first, and we remove only what the representative designates.',
    auctioneer:
      'You take what is worth selling. We take what is not, which means you are not the one explaining to the family who deals with the rest.',
    senior_move:
      'When somebody moves into somewhere smaller, a good deal of a house does not go with them. We clear what is left once your part is done.',
    contractor:
      'Tear-out debris and haul-off, so your crew and your truck stay on the work you are actually being paid for.',
    cleaning:
      'You cannot clean a room that is still full. We empty it first, which means you can say yes to the whole job and still only do your half of it.',
    nonprofit:
      'Two directions: anything genuinely worth donating out of a cleanout should come to you, and when you have to decline a donation, the donor still needs somebody to take it.',
    other:
      'We clear properties — houses, garages, basements, barns, storage units and rentals — and haul the load away.'
  };

  // db.js seeds the operator record with the literal name "Owner" when
  // OWNER_NAME is unset, which is a sensible database default and a terrible
  // thing to put in a letter -- "I am Owner at RYDJA" is worse than not
  // introducing yourself at all. So a placeholder name is treated as absent.
  const named = business.ownerName && business.ownerName.trim().toLowerCase() !== 'owner'
    ? business.ownerName.trim()
    : '';

  const body = [
    `Hi ${who},`,
    '',
    named
      ? `I am ${named}, the owner of ${business.brand}. We do junk removal, property cleanouts and hauling across ${business.area}.`
      : `${business.brand} does junk removal, property cleanouts and hauling across ${business.area}, and I am the owner.`,
    '',
    reasons[partner.kind] || reasons.other,
    '',
    'Every job is quoted from photographs before anything is booked, and the price we send is the price unless the scope changes and you agree to a different one. We are not an estate buyer and we do not appraise contents — we clear what the owner tells us to clear, and nothing else.',
    '',
    'If it is useful, keep us on your list for the next one. If you would rather I did not follow up, say so and I will not.',
    '',
    named || business.brand,
    named ? business.brand : '',
    business.phone || '',
    business.email || '',
    business.siteUrl || ''
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');

  return { subject: subjects[partner.kind] || subjects.other, body, why: k.why };
}

/**
 * The link we hand a partner, or '' if they have no code.
 *
 * Points at the homepage rather than at a landing page: there is no separate
 * partner page to maintain, and the whole purpose of the code is attribution.
 */
const referralLink = (partner, siteUrl) =>
  partner.referral_code ? `${siteUrl}/?ref=${partner.referral_code}` : '';

module.exports = {
  KINDS,
  KIND_VALUES,
  STATUSES,
  STATUS_VALUES,
  OPEN_STATUSES,
  CHANNELS,
  CHANNEL_VALUES,
  DIRECTIONS,
  CODE_PATTERN,
  migrate,
  kind,
  statusLabel,
  channelLabel,
  randomCode,
  uniqueCode,
  normalizeCode,
  list,
  get,
  byCode,
  touches,
  leadsFor,
  due,
  summary,
  outreachDraft,
  referralLink
};
