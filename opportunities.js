'use strict';

// Publicly advertised work, tracked from the notice to the invoice.
//
// ------------------------------------------------------------------ the idea
//
// partners.js builds relationships: an estate-sale company that remembers your
// name sends work for years. This file is the other half, and it is the faster
// one — a single piece of work somebody has already advertised, with a date on
// it, that is available to whoever answers first.
//
// A county puts a debris-removal contract out to bid. A storage facility
// publishes a lien-sale notice. A tax-foreclosure auction list goes up and
// sixty properties are about to change hands, each needing clearing. An estate
// sale finishes on Sunday and the house still has everything nobody bought in
// it on Monday. None of that is a secret, none of it needs buying, and all of
// it is sitting in public where almost nobody local is reading it
// systematically.
//
// The difference between a partner and an opportunity is worth keeping
// straight, because they are worked differently: a partner is cultivated and
// pays off repeatedly; an opportunity is answered quickly and pays off once.
// Both end in the same place — a lead, a quote, a job, money — and this file
// carries the link that makes that chain visible.
//
// ---------------------------------------------------------- nothing is fetched
//
// This application makes no outbound request to any of the sources below, and
// it never should. Every opportunity is entered by a person who read a notice
// and judged it worth the trip.
//
// That is not timidity, it is the only version that works. Half these sources
// forbid automated access in their terms; the half that do not are published
// as PDFs and board minutes that no parser survives. And the judgement is the
// valuable part: "is this job real, is it in our area, can we actually do it"
// is a thirty-second human decision and an unsolvable machine one. A list of
// two hundred harvested notices is worth less than five a person looked at.
//
// So what this file provides instead is structure: which sources are worth
// reading, what each is good for, what the rules around each one are, and a
// record that survives the owner's memory.

// ------------------------------------------------------------- source posture
//
// Every source carries one of three postures, and the posture is enforced
// rather than advisory.

/** Published for exactly this purpose. Read it, use it, cite it. */
const AUTHORIZED = 'authorized';

/**
 * Public to a person, closed to a machine.
 *
 * Reading it in a browser is what it is for; automated collection is against
 * the platform's terms. A person may read it and type what they found. Nothing
 * here may ever fetch it.
 */
const MANUAL_ONLY = 'manual_only';

/**
 * Not to be used as a prospecting source at all.
 *
 * Kept in the list, with the reason, because the useful thing about a
 * prohibited source is knowing *why* it is prohibited — otherwise somebody
 * rediscovers it in six months and has the argument again.
 */
const RESTRICTED = 'restricted';

/**
 * Where legitimate work is advertised in this service area.
 *
 * Ordered by what has actually produced work for a one-truck operation, best
 * first. The `what` is what you are looking for; the `rule` is the thing that
 * is easy to get wrong.
 */
const SOURCES = [
  {
    value: 'estate_sale_listing',
    label: 'Estate sale listings',
    posture: MANUAL_ONLY,
    where: 'EstateSales.net, EstateSale.com, and the sale companies\' own pages',
    what:
      'A sale that ends this weekend is a house that needs emptying next week. The company running it is ' +
      'the person to talk to, not the family — and if they are good they already have a hauler, which is ' +
      'why the conversation is worth having before you need it.',
    rule:
      'Read in a browser like anybody else. These sites forbid automated collection and nothing here fetches ' +
      'them. A sale found this way is better recorded as a PARTNER (the company) than as a one-off job.'
  },
  {
    value: 'bid_board',
    label: 'Municipal and county bid boards',
    posture: AUTHORIZED,
    where:
      'Kent, Montcalm and Ionia county purchasing pages; the cities of Lowell, Greenville, Ionia and Belding; ' +
      'Michigan SIGMA VSS for state work',
    what:
      'Debris removal, property cleanup, demolition, blight clearance and surplus hauling. Published with a ' +
      'closing date because they want bidders — which is the opposite of a source you have to be clever about.',
    rule:
      'Read the whole solicitation before bidding, especially insurance and bonding requirements. RYDJA holds ' +
      'no verified insurance certificate, so a contract requiring one is a pass, not a maybe. Record the pass ' +
      'and the reason.'
  },
  {
    value: 'public_notice',
    label: 'Legal and public notices',
    posture: AUTHORIZED,
    where: 'Lowell Ledger, The Daily News (Greenville), Ionia Sentinel-Standard, and county legal-notice pages',
    what:
      'Self-storage lien sales, abandoned-property notices, estate notices, demolition orders. Printed ' +
      'specifically so the public reads them.',
    rule:
      'The notice tells you a property or a unit is about to need clearing. The person to contact is the one ' +
      'named in the notice — the facility, the municipality, the attorney — and never a bereaved family.'
  },
  {
    value: 'auction_list',
    label: 'Tax-foreclosure and auction lists',
    posture: AUTHORIZED,
    where: 'County treasurer auction lists, land bank inventories, public surplus auctions',
    what:
      'Properties about to change hands. The buyer is the customer, not the county: somebody who has just ' +
      'bought a house sight-unseen at auction has a cleanout and knows it.',
    rule:
      'Published lists only. Approach the new owner after the sale, not the occupant before it — and never ' +
      'anybody being foreclosed on.'
  },
  {
    value: 'storage_auction',
    label: 'Storage unit auction notices',
    posture: AUTHORIZED,
    where: 'Facility notices, and the auction sites facilities publish to',
    what:
      'An abandoned unit has to be empty before it can be re-let. Units are a known size, which makes them ' +
      'easy to price off a photograph.',
    rule: 'Talk to the facility. They are a repeat customer waiting to happen — record them as a partner too.'
  },
  {
    value: 'probate',
    label: 'Probate court filings',
    posture: AUTHORIZED,
    where: 'Montcalm County Probate Court (Stanton) and Kent County Probate Court (Grand Rapids)',
    what:
      'A newly opened estate is a property that will need clearing, usually with a personal representative ' +
      'who has never done this before.',
    // The hardest rule in the file, and the reason this source has one at all.
    rule:
      'PUBLIC RECORD, AND NOT A MAILING LIST. Nobody at RYDJA contacts a bereaved family because their name ' +
      'appeared on a court docket. That is how a local business becomes the one everybody warns each other ' +
      'about, and in some states it is regulated besides. The legitimate use is the professionals: the ' +
      'attorneys and personal representatives who appear on these filings repeatedly are worth knowing, and ' +
      'they are the ones who hand our name to the family. Record the ATTORNEY as a partner. Do not record ' +
      'the decedent, the family, or the address.'
  },
  {
    value: 'property_listing',
    label: 'Real estate listings',
    posture: MANUAL_ONLY,
    where: 'Public MLS-fed listing sites, and agents\' own pages',
    what:
      'An estate or as-is listing, or photographs showing a full garage, is a Realtor with a problem. The ' +
      'listing agent is the contact.',
    rule:
      'Read as a member of the public. Listing data is licensed and automated collection is against the terms ' +
      'of every site that carries it. The agent is better recorded as a partner than the house as a job.'
  },
  {
    value: 'marketplace',
    label: 'Marketplace and free-to-collect listings',
    posture: MANUAL_ONLY,
    where: 'Facebook Marketplace, Craigslist free sections, local buy/sell groups',
    what:
      'Somebody with more than they realised. A free piano is rarely a job; the basement it is standing in ' +
      'sometimes is.',
    rule:
      'Browse as a person. Automated access is against both platforms\' terms. Reply only where the listing ' +
      'invites contact, answer the question they actually asked, and do not pitch in a group that forbids it.'
  },
  {
    value: 'community_request',
    label: 'Somebody asking for a recommendation',
    posture: MANUAL_ONLY,
    where: 'Nextdoor, local Facebook groups, community boards',
    what: 'The warmest lead there is: a person asking in public who to call.',
    rule:
      'Answer only where the group permits a business to, and answer once. Most local groups have a day for ' +
      'it and a rule against the rest of the week. Read the rule before posting; being thrown out of a ' +
      'Lowell group costs more than the job.'
  },
  {
    value: 'walk_in',
    label: 'Came to us',
    posture: AUTHORIZED,
    where: 'The phone, the quote form, somebody flagging down the truck',
    what: 'Recorded here only when it is not yet a lead — a conversation that may become one.',
    rule: 'Once there is a name and a job, it belongs in the lead inbox. This is for the ones still forming.'
  },
  {
    value: 'purchased_list',
    label: 'Bought leads and scraped lists',
    posture: RESTRICTED,
    where: 'Angi, Thumbtack, HomeAdvisor, Networx, data brokers, scraped directories',
    what:
      'Per-lead marketplaces and bought contact lists. What they yield is the same enquiry sold to four ' +
      'competitors at once, a customer trained to choose on price before anybody has seen the job, and a ' +
      'monthly bill that stops producing the day it stops being paid.',
    rule:
      'NOT USED. Paid per-lead marketplaces resell the same lead to four competitors and train the customer ' +
      'to shop on price; a scraped list is somebody else\'s terms of service and our reputation. The whole ' +
      'point of this system is a lead source RYDJA owns. Recording one here is refused.'
  }
];

const SOURCE_VALUES = SOURCES.map((s) => s.value);
const source = (value) => SOURCES.find((s) => s.value === value) || SOURCES[SOURCES.length - 1];

/** A source a person may legitimately work from. Anything else is refused. */
const usableSource = (value) => {
  const s = SOURCES.find((x) => x.value === value);
  return Boolean(s) && s.posture !== RESTRICTED;
};

// ---------------------------------------------------------------- the work

/** What kind of job this is, in the words the quote form and the admin use. */
const KINDS = [
  { value: 'estate', label: 'Estate / whole property' },
  { value: 'cleanout', label: 'Cleanout (garage, basement, barn)' },
  { value: 'rental_turnover', label: 'Rental turnover' },
  { value: 'storage_unit', label: 'Storage unit' },
  { value: 'junk_removal', label: 'Junk removal / hauling' },
  { value: 'yard', label: 'Yard / property cleanup' },
  { value: 'demolition', label: 'Light demolition' },
  { value: 'contract', label: 'Contract or bid' },
  { value: 'other', label: 'Other' }
];

const KIND_VALUES = KINDS.map((k) => k.value);
const kindLabel = (value) => (KINDS.find((k) => k.value === value) || {}).label || value;

/**
 * Where an opportunity stands.
 *
 * `passed` is a first-class outcome and not a failure. A bid requiring an
 * insurance certificate RYDJA does not hold is a pass, and recording it with
 * the reason is how the same half-hour is not spent on it again next quarter.
 */
const STATUSES = [
  { value: 'new', label: 'New', hint: 'Spotted. Nothing done yet.' },
  { value: 'researching', label: 'Researching', hint: 'Working out whether it is real and whether we can do it.' },
  { value: 'contacted', label: 'Contacted', hint: 'We have reached out.' },
  { value: 'quoted', label: 'Quoted', hint: 'A price is with them.' },
  { value: 'won', label: 'Won', hint: 'It became a job.' },
  { value: 'lost', label: 'Lost', hint: 'Somebody else got it, or they did not proceed.' },
  { value: 'passed', label: 'Passed', hint: 'We decided not to chase it. The reason matters.' }
];

const STATUS_VALUES = STATUSES.map((s) => s.value);
const statusLabel = (value) => (STATUSES.find((s) => s.value === value) || {}).label || value;

/** Stages still worth spending time on. */
const OPEN_STATUSES = ['new', 'researching', 'contacted', 'quoted'];

/** Stages that are finished, one way or another. */
const CLOSED_STATUSES = ['won', 'lost', 'passed'];

// ---------------------------------------------------------------- the schema

const SCHEMA = `
create table if not exists opportunities (
  id           integer primary key autoincrement,
  title        text    not null,
  kind         text    not null default 'other',
  source_kind  text    not null default 'other',
  status       text    not null default 'new',
  -- Where it was advertised. The URL is the citation: in six months the
  -- question "how did we hear about this" has an answer.
  source_url   text,
  source_note  text,
  city         text,
  -- Who to talk to. Often a business rather than a householder -- a facility
  -- manager, a listing agent, a county purchasing clerk.
  contact_name  text,
  contact_phone text,
  contact_email text,
  -- The partner who told us, where one did. This is what makes a partner's
  -- page able to show work they sent that never went through their link.
  partner_id   integer references partners(id),
  -- A closing date, bid deadline or sale end. Drives the "due" list.
  closes_on    text,
  -- OUR OWN rough guess at what the job is worth, in cents. Explicitly not a
  -- quote: a quote is a row in the quotes table with a customer attached, and
  -- conflating the two would put invented money on a dashboard.
  est_value_cents integer,
  -- Set when this turns into a real lead, which is what connects an
  -- opportunity to the money it eventually produced.
  lead_id      integer references leads(id),
  -- Why we passed, for the ones we did. Read before chasing a similar one.
  outcome_note text,
  notes        text,
  next_step    text,
  next_step_on text,
  created_at   text    not null default (datetime('now')),
  archived_at  text
);
create index if not exists idx_opps_status on opportunities(status);
create index if not exists idx_opps_due    on opportunities(next_step_on);
create index if not exists idx_opps_lead   on opportunities(lead_id);
`;

/**
 * Create the table, and widen the touch log to cover opportunities too.
 *
 * partner_touches already holds "what was said and when" in exactly the shape
 * an opportunity needs. Rather than a second table with the same five columns,
 * partner_id becomes nullable and opportunity_id is added beside it: one row
 * belongs to one or the other. SQLite cannot drop a NOT NULL constraint with
 * ALTER, so the table is rebuilt -- which is safe here and is written to be
 * safe even if it were not: it copies every existing row across inside a
 * transaction and only then drops the old one.
 */
function migrate(db) {
  db.exec(SCHEMA);

  const columns = new Set(db.prepare('pragma table_info(partner_touches)').all().map((c) => c.name));
  if (columns.has('opportunity_id')) return;

  db.exec('begin');
  try {
    db.exec(`
      create table partner_touches_new (
        id            integer primary key autoincrement,
        partner_id    integer references partners(id),
        opportunity_id integer references opportunities(id),
        channel       text    not null,
        direction     text    not null default 'out',
        summary       text    not null,
        happened_on   text,
        created_at    text    not null default (datetime('now'))
      );
      insert into partner_touches_new (id, partner_id, channel, direction, summary, happened_on, created_at)
        select id, partner_id, channel, direction, summary, happened_on, created_at from partner_touches;
      drop table partner_touches;
      alter table partner_touches_new rename to partner_touches;
      create index if not exists idx_touches_partner on partner_touches(partner_id, created_at);
      create index if not exists idx_touches_opp on partner_touches(opportunity_id, created_at);
    `);
    db.exec('commit');
    console.log('[migrate] partner_touches now covers opportunities too');
  } catch (err) {
    db.exec('rollback');
    throw err;
  }
}

// ---------------------------------------------------------------- queries

function list(db, { status, kind, source_kind: sourceKind, open, q } = {}) {
  const where = ['o.archived_at is null'];
  const args = [];

  if (STATUS_VALUES.includes(status)) {
    where.push('o.status = ?');
    args.push(status);
  } else if (open) {
    where.push(`o.status in (${OPEN_STATUSES.map(() => '?').join(', ')})`);
    args.push(...OPEN_STATUSES);
  }
  if (KIND_VALUES.includes(kind)) {
    where.push('o.kind = ?');
    args.push(kind);
  }
  if (SOURCE_VALUES.includes(sourceKind)) {
    where.push('o.source_kind = ?');
    args.push(sourceKind);
  }
  if (q) {
    where.push("(o.title like ? escape '\\' or o.city like ? escape '\\' or o.contact_name like ? escape '\\')");
    args.push(q, q, q);
  }

  return db
    .prepare(
      `select o.*,
              p.name as partner_name,
              l.work_ref as lead_ref,
              (select count(*) from partner_touches t where t.opportunity_id = o.id) as touches
         from opportunities o
         left join partners p on p.id = o.partner_id
         left join leads l on l.id = o.lead_id
        where ${where.join(' and ')}
        order by case o.status
                   when 'quoted' then 0 when 'contacted' then 1 when 'researching' then 2
                   when 'new' then 3 when 'won' then 4 else 5 end,
                 -- A deadline sorts before no deadline, which is what somebody
                 -- scanning this list is actually looking for.
                 case when o.closes_on is null or o.closes_on = '' then 1 else 0 end,
                 o.closes_on,
                 o.created_at desc`
    )
    .all(...args);
}

const get = (db, id) => db.prepare('select * from opportunities where id = ?').get(id);

const touches = (db, id) =>
  db
    .prepare('select * from partner_touches where opportunity_id = ? order by created_at desc, id desc')
    .all(id);

/** Counts per stage, for the top of the list. */
function summary(db) {
  const rows = db
    .prepare('select status, count(*) as n from opportunities where archived_at is null group by status')
    .all();
  const by = new Map(rows.map((r) => [r.status, r.n]));
  return STATUSES.map((s) => ({ ...s, n: by.get(s.value) || 0 }));
}

/**
 * What needs doing: a next step that has come due, or a deadline inside a week.
 *
 * A deadline is the thing that makes an opportunity different from a partner.
 * A bid that closes on Friday is worth nothing on Saturday, so the window is
 * part of the query rather than something the owner has to notice.
 */
function due(db, today, soon) {
  return db
    .prepare(
      `select id, title, city, status, kind, next_step, next_step_on, closes_on
         from opportunities
        where archived_at is null
          and status in (${OPEN_STATUSES.map(() => '?').join(', ')})
          and (
            (next_step_on is not null and next_step_on != '' and next_step_on <= ?)
            or (closes_on is not null and closes_on != '' and closes_on <= ?)
          )
        order by case when closes_on is null or closes_on = '' then 1 else 0 end,
                 closes_on, next_step_on`
    )
    .all(...OPEN_STATUSES, today, soon);
}

/** Opportunities a partner told us about, for their page. */
const forPartner = (db, partnerId) =>
  db
    .prepare(
      `select id, title, status, kind, est_value_cents, lead_id, created_at
         from opportunities
        where partner_id = ? and archived_at is null
        order by created_at desc`
    )
    .all(partnerId);

// ---------------------------------------------------------------- the money
//
// The one question the whole acquisition effort has to be able to answer: did
// it produce paying work?

/**
 * The money chain for a set of leads: quoted, approved, completed, revenue.
 *
 * Takes lead ids rather than a source, so the same function serves a partner's
 * page, an opportunity list and the dashboard — and the four pages cannot
 * disagree about what a lead was worth.
 *
 * Revenue is counted over COMPLETED jobs only. An approved quote is a promise
 * and a completed job is money, and a dashboard that calls the first one
 * revenue is a dashboard that lies in the direction everybody wants it to.
 */
function moneyFor(db, leadIds) {
  const empty = { leads: 0, quoted: 0, quotedValue: 0, approved: 0, approvedValue: 0, completed: 0, revenue: 0 };
  if (!leadIds || !leadIds.length) return empty;

  const marks = leadIds.map(() => '?').join(', ');
  const row = db
    .prepare(
      `select
         (select count(distinct lead_id) from quotes where lead_id in (${marks})) as quoted,
         (select coalesce(sum(amount_cents), 0) from quotes q
           where q.lead_id in (${marks})
             and q.id = (select max(id) from quotes q2 where q2.lead_id = q.lead_id)) as quotedValue,
         (select count(distinct lead_id) from quotes
           where lead_id in (${marks}) and status = 'approved') as approved,
         (select coalesce(sum(amount_cents), 0) from quotes
           where lead_id in (${marks}) and status = 'approved') as approvedValue,
         (select count(*) from jobs
           where lead_id in (${marks}) and status = 'complete' and archived_at is null) as completed,
         (select coalesce(sum(customer_total_cents), 0) from jobs
           where lead_id in (${marks}) and status = 'complete' and archived_at is null) as revenue`
    )
    .get(...leadIds, ...leadIds, ...leadIds, ...leadIds, ...leadIds, ...leadIds);

  return { leads: leadIds.length, ...row };
}

/** The lead ids an opportunity set produced. */
const leadIdsFromOpportunities = (db) =>
  db
    .prepare('select lead_id from opportunities where lead_id is not null and archived_at is null')
    .all()
    .map((r) => r.lead_id);

/** The lead ids a partner's referral link produced. */
const leadIdsForCode = (db, code) =>
  code
    ? db
      .prepare('select id from leads where referral_code = ? and archived_at is null')
      .all(code)
      .map((r) => r.id)
    : [];

module.exports = {
  AUTHORIZED,
  MANUAL_ONLY,
  RESTRICTED,
  SOURCES,
  SOURCE_VALUES,
  KINDS,
  KIND_VALUES,
  STATUSES,
  STATUS_VALUES,
  OPEN_STATUSES,
  CLOSED_STATUSES,
  migrate,
  source,
  usableSource,
  kindLabel,
  statusLabel,
  list,
  get,
  touches,
  summary,
  due,
  forPartner,
  moneyFor,
  leadIdsFromOpportunities,
  leadIdsForCode
};
