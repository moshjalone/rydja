-- Property Services V1 schema (SQLite).
-- Flow: lead -> quote -> job -> expenses / salvage / photos -> profit.
--
-- Deliberately small. Every job carries operator_id so independent
-- contractors can be added later without changing the job model.

pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists operators (
  id         integer primary key autoincrement,
  name       text    not null,
  phone      text,
  email      text,
  role       text    not null default 'owner',   -- owner | contractor
  active     integer not null default 1,
  created_at text    not null default (datetime('now'))
);

create table if not exists customers (
  id         integer primary key autoincrement,
  name       text    not null,
  phone      text    not null unique,
  email      text,
  created_at text    not null default (datetime('now'))
);

-- work_ref is the permanent, human-readable reference for a piece of work
-- (RYDJA-7K4M2Q). It is public, it is NOT a capability -- public_token stays
-- the only thing that grants access -- and it never changes: the job a
-- customer approves keeps the reference its request was given. Jobs reach it
-- through lead_id rather than storing a copy, so the two can never disagree.
-- Nullable only because SQLite cannot ALTER a NOT NULL column onto an existing
-- table; every insert sets it, and the backfill in db.js fills in old rows.
create table if not exists leads (
  id            integer primary key autoincrement,
  customer_id   integer not null references customers(id),
  public_token  text    not null unique,         -- customer's private link
  work_ref      text,                            -- RYDJA-XXXXXX, public, permanent
  service       text    not null,
  description   text    not null,
  address       text,
  city          text,
  state         text,
  zip           text    not null,
  access        text,
  timing        text,
  status        text    not null default 'new',   -- new | quoted | approved | declined | converted
  -- What the customer said they would like, at intake. Preferences only: these
  -- never reach jobs.scheduled_for. Dates are bare YYYY-MM-DD in local business
  -- time, stored exactly as typed -- the same way scheduled_for is wall clock.
  pref_date_1   text,
  pref_window_1 text,                            -- morning | midday | afternoon | evening | flexible
  pref_date_2   text,
  pref_window_2 text,
  scheduling_flexible integer not null default 0,
  scheduling_note text,
  -- Estate / whole-property cleanouts, and only those. Three optional
  -- answers from the quote form, stored as the customer gave them: areas is
  -- the ticked list joined with ', ', scope is one of a fixed set of phrases,
  -- and deadline is free text because "before the closing on the 14th" is a
  -- more useful answer than a date field would allow. All NULL on every other
  -- kind of lead, which is what makes an estate lead recognisable in the admin
  -- without a second table or a flag that could disagree with the service.
  estate_areas    text,
  estate_scope    text,
  estate_deadline text,
  -- "Ask a question" from the customer's own page. Latest one wins; the owner
  -- reads it on the lead and answers by phone.
  customer_message    text,
  customer_message_at text,
  -- Where this lead came from, taken from the first public page of the visit:
  -- the campaign parameters in the URL we handed out, plus the referring host.
  -- `source` is the normalised bucket (google | facebook | bing | referral |
  -- direct | other) and utm_source keeps the raw value beside it. NULL means we
  -- never saw the visit, which is not the same thing as 'direct'.
  source        text,
  utm_source    text,
  medium        text,
  campaign      text,
  content       text,
  term          text,
  referrer      text,                            -- host only, never a full URL
  landing_path  text,                            -- path only, never the query
  created_at    text    not null default (datetime('now'))
);

create table if not exists lead_photos (
  id         integer primary key autoincrement,
  lead_id    integer not null references leads(id),
  filename   text    not null,
  created_at text    not null default (datetime('now'))
);

create table if not exists quotes (
  id           integer primary key autoincrement,
  lead_id      integer not null references leads(id),
  amount_cents integer not null,
  notes        text,
  status       text    not null default 'sent',   -- sent | approved | declined
  -- An appointment the owner attached when sending this quote, so the customer
  -- can agree to the price and the time in one click. Still only a proposal:
  -- it reaches jobs.scheduled_for only if they confirm it.
  proposed_for text,
  -- Which version of the Terms the customer was shown when they approved, set
  -- at the moment of approval. NULL means the approval predates the Terms, and
  -- is left NULL on purpose: an old approval never saw them, and recording
  -- otherwise would be a false record of consent.
  terms_version text,
  created_at   text    not null default (datetime('now')),
  responded_at text
);

-- Scheduling is a proposal the customer answers, not something the owner sets
-- unilaterally: scheduled_for stays NULL until the customer accepts. The
-- proposed_* columns hold the offer, schedule_responded_at is when the customer
-- last answered one, and schedule_message is their "that time doesn't work"
-- reply. No calendar, no slots -- one open offer at a time.
create table if not exists jobs (
  id                  integer primary key autoincrement,
  lead_id             integer not null references leads(id),
  quote_id            integer not null references quotes(id),
  operator_id         integer not null references operators(id),
  status              text    not null default 'unscheduled', -- unscheduled | schedule_pending | scheduled | in_progress | complete | cancelled
  scheduled_for       text,                      -- set only by customer acceptance
  proposed_for        text,                      -- the time the owner offered
  proposed_at         text,                      -- when that offer went out
  schedule_responded_at text,                    -- when the customer last answered one
  schedule_message    text,                      -- "what works better for you?"
  customer_total_cents integer not null,
  started_at          text,
  completed_at        text,
  created_at          text    not null default (datetime('now'))
);

-- Disposal/dump cost is an expense with category 'dump'; weight_lbs is
-- only filled in for those. One table instead of two.
create table if not exists job_expenses (
  id           integer primary key autoincrement,
  job_id       integer not null references jobs(id),
  category     text    not null,                 -- dump | fuel | helper | supplies | equipment | other
  amount_cents integer not null,
  weight_lbs   real,
  note         text,
  created_at   text    not null default (datetime('now'))
);

create table if not exists salvage_items (
  id                    integer primary key autoincrement,
  job_id                integer not null references jobs(id),
  title                 text    not null,
  disposition           text    not null default 'resell', -- resell | scrap | donate | recycle | keep
  estimated_value_cents integer not null default 0,
  realized_value_cents  integer,                 -- null until sold
  notes                 text,
  created_at            text    not null default (datetime('now'))
);

create table if not exists job_photos (
  id         integer primary key autoincrement,
  job_id     integer not null references jobs(id),
  phase      text    not null,                   -- before | after
  filename   text    not null,
  created_at text    not null default (datetime('now'))
);

-- Note: the unique index on leads(work_ref) is created by migrate() in db.js,
-- not here. An existing database reaches this file before the column has been
-- added, and indexing a column that is not there yet fails the whole boot.
create index if not exists idx_leads_status    on leads(status);
create index if not exists idx_jobs_status     on jobs(status);
create index if not exists idx_expenses_job    on job_expenses(job_id);
create index if not exists idx_salvage_job     on salvage_items(job_id);
create index if not exists idx_job_photos_job  on job_photos(job_id);
create index if not exists idx_lead_photos     on lead_photos(lead_id);
