-- 002-society.sql — residents, households, kinship, economy, estates, migration.

create table residents (
  id                integer primary key autoincrement,
  world_id          integer not null references worlds(id) on delete cascade,
  name              text    not null,
  sex               text    not null,
  born_day          integer not null,
  origin            text    not null default 'founder',
  status            text    not null default 'living',
  death_day         integer,
  death_cause       text,
  household_id      integer,
  partner_id        integer,
  mother_id         integer,
  father_id         integer,
  guardian_id       integer,
  traits_json       text    not null default '{}',
  skills_json       text    not null default '{}',
  health_state      text    not null default 'healthy',
  health_json       text    not null default '{}',
  hunger_days       integer not null default 0,
  education_days    integer not null default 0,
  legacy_of         integer,
  emigrated_day     integer,
  destination       text,
  rng_salt          integer not null,
  created_at        text    not null
);

create index residents_world_status on residents (world_id, status);
create index residents_household on residents (world_id, household_id);

create table households (
  id           integer primary key autoincrement,
  world_id     integer not null references worlds(id) on delete cascade,
  name         text    not null,
  building_id  integer,
  capacity     integer not null,
  formed_day   integer not null,
  dissolved_day integer
);

create index households_world on households (world_id);

create table kinship (
  id       integer primary key autoincrement,
  world_id integer not null references worlds(id) on delete cascade,
  a_id     integer not null,
  b_id     integer not null,
  kind     text    not null,
  since_day integer not null,
  unique (world_id, a_id, b_id, kind)
);

create index kinship_a on kinship (world_id, a_id);
create index kinship_b on kinship (world_id, b_id);

create table relationships (
  id            integer primary key autoincrement,
  world_id      integer not null references worlds(id) on delete cascade,
  a_id          integer not null,
  b_id          integer not null,
  kind          text    not null,
  trust         integer not null default 50,
  intimacy      integer not null default 0,
  public_belief integer not null default 50,
  since_day     integer not null,
  until_day     integer,
  cooldown_until integer,
  unique (world_id, a_id, b_id, kind)
);

create index relationships_a on relationships (world_id, a_id);

create table pregnancies (
  id           integer primary key autoincrement,
  world_id     integer not null references worlds(id) on delete cascade,
  mother_id    integer not null,
  father_id    integer not null,
  conceived_day integer not null,
  due_day      integer not null,
  status       text    not null default 'active',
  child_id     integer,
  resolved_day integer
);

create index pregnancies_due on pregnancies (world_id, status, due_day);

create table buildings (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  name        text    not null,
  kind        text    not null,
  capacity    integer not null default 0,
  condition_bps integer not null default 10000,
  built_day   integer not null,
  destroyed_day integer,
  private     integer not null default 0
);

create table businesses (
  id           integer primary key autoincrement,
  world_id     integer not null references worlds(id) on delete cascade,
  name         text    not null,
  kind         text    not null,
  owner_type   text    not null default 'resident',
  owner_id     integer,
  manager_id   integer,
  building_id  integer,
  cash_cents   integer not null default 0,
  opened_day   integer not null,
  closed_day   integer,
  status       text    not null default 'open',
  settings_json text   not null default '{}'
);

create index businesses_world_status on businesses (world_id, status);

create table contracts (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  kind        text    not null,
  a_id        integer,
  b_id        integer,
  business_id integer,
  terms_json  text    not null,
  start_day   integer not null,
  end_day     integer,
  status      text    not null default 'active'
);

create index contracts_active on contracts (world_id, kind, status);

create table accounts (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  owner_type  text    not null,
  owner_id    integer,
  balance_cents integer not null default 0,
  unique (world_id, owner_type, owner_id)
);

create table ledger_entries (
  id            integer primary key autoincrement,
  world_id      integer not null references worlds(id) on delete cascade,
  day           integer not null,
  phase         text    not null,
  txn_id        text    not null,
  account_id    integer not null references accounts(id),
  delta_cents   integer not null,
  reason        text    not null,
  event_id      integer,
  created_at    text    not null
);

create index ledger_day on ledger_entries (world_id, day);
create index ledger_account on ledger_entries (world_id, account_id, day);

create table inventories (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  owner_type  text    not null,
  owner_id    integer,
  good        text    not null,
  quantity    integer not null default 0,
  reserved    integer not null default 0,
  unique (world_id, owner_type, owner_id, good)
);

create index inventories_good on inventories (world_id, good);

create table goods_flows (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  day         integer not null,
  phase       text    not null,
  owner_type  text    not null,
  owner_id    integer,
  good        text    not null,
  delta       integer not null,
  reason      text    not null,
  event_id    integer
);

create index goods_flows_day on goods_flows (world_id, day, good);

create table market_prices (
  world_id    integer not null references worlds(id) on delete cascade,
  good        text    not null,
  price_cents integer not null,
  updated_day integer not null,
  primary key (world_id, good)
);

create table estates (
  id            integer primary key autoincrement,
  world_id      integer not null references worlds(id) on delete cascade,
  deceased_id   integer not null,
  opened_day    integer not null,
  closed_day    integer,
  status        text    not null default 'open',
  total_cents   integer not null default 0,
  will_json     text,
  escrow_cents  integer not null default 0
);

create table estate_claims (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  estate_id   integer not null references estates(id) on delete cascade,
  claimant_id integer,
  kind        text    not null,
  amount_cents integer not null,
  status      text    not null default 'pending',
  resolved_day integer
);

create table tax_records (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  day         integer not null,
  resident_id integer,
  kind        text    not null,
  amount_cents integer not null
);

create index tax_records_day on tax_records (world_id, day);

create table shipping_runs (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  day         integer not null,
  cash_cents  integer not null,
  goods_json  text    not null,
  direction   text    not null,
  created_at  text    not null
);
