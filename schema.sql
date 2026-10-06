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

create table if not exists leads (
  id            integer primary key autoincrement,
  customer_id   integer not null references customers(id),
  public_token  text    not null unique,         -- customer's private link
  service       text    not null,
  description   text    not null,
  address       text,
  city          text,
  state         text,
  zip           text    not null,
  access        text,
  timing        text,
  status        text    not null default 'new',   -- new | quoted | approved | declined | converted
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
  created_at   text    not null default (datetime('now')),
  responded_at text
);

create table if not exists jobs (
  id                  integer primary key autoincrement,
  lead_id             integer not null references leads(id),
  quote_id            integer not null references quotes(id),
  operator_id         integer not null references operators(id),
  status              text    not null default 'unscheduled', -- unscheduled | scheduled | in_progress | complete | cancelled
  scheduled_for       text,
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

create index if not exists idx_leads_status    on leads(status);
create index if not exists idx_jobs_status     on jobs(status);
create index if not exists idx_expenses_job    on job_expenses(job_id);
create index if not exists idx_salvage_job     on salvage_items(job_id);
create index if not exists idx_job_photos_job  on job_photos(job_id);
create index if not exists idx_lead_photos     on lead_photos(lead_id);
