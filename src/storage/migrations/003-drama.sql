-- 003-drama.sql — health, hazards, crime/justice, factions/politics, unrest.

create table health_cases (
  id                integer primary key autoincrement,
  world_id          integer not null references worlds(id) on delete cascade,
  resident_id       integer not null,
  disease           text    not null,
  state             text    not null,
  severity          integer not null default 1,
  since_day         integer not null,
  infectious_until  integer,
  treated_days      integer not null default 0,
  resolved_day      integer,
  outcome           text
);

create index health_cases_active on health_cases (world_id, state);

create table injuries (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  resident_id integer not null,
  kind        text    not null,
  severity    integer not null default 1,
  since_day   integer not null,
  until_day   integer,
  disability  integer not null default 0,
  resolved_day integer,
  death_roll  integer
);

create index injuries_active on injuries (world_id, resident_id, resolved_day);

create table disasters (
  id           integer primary key autoincrement,
  world_id     integer not null references worlds(id) on delete cascade,
  kind         text    not null,
  day          integer not null,
  severity     integer not null default 1,
  building_id  integer,
  stage        text    not null,
  damage_json  text,
  closed_day   integer
);

create table cases (
  id             integer primary key autoincrement,
  world_id       integer not null references worlds(id) on delete cascade,
  kind           text    not null,
  defendant_id   integer not null,
  plaintiff_id   integer,
  opened_day     integer not null,
  status         text    not null default 'investigating',
  investigation_days integer not null default 0,
  prosecution_bps integer not null default 0,
  defence_bps    integer not null default 0,
  verdict        text,
  closed_day     integer,
  disputed_estate_id integer,
  truth_json     text
);

create index cases_open on cases (world_id, status);

create table evidence (
  id            integer primary key autoincrement,
  world_id      integer not null references worlds(id) on delete cascade,
  case_id       integer not null references cases(id) on delete cascade,
  kind          text    not null,
  weight_bps    integer not null,
  public        integer not null default 0,
  source_event_id integer,
  created_day   integer not null
);

create table sentences (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  case_id     integer not null references cases(id) on delete cascade,
  kind        text    not null,
  amount_cents integer not null default 0,
  days        integer not null default 0,
  start_day   integer not null,
  end_day     integer,
  status      text    not null default 'active'
);

create index sentences_active on sentences (world_id, status, end_day);

create table factions (
  id           integer primary key autoincrement,
  world_id     integer not null references worlds(id) on delete cascade,
  name         text    not null,
  interest     text    not null,
  leader_id    integer,
  funds_cents  integer not null default 0,
  support_bps  integer not null default 0,
  created_day  integer not null,
  dissolved_day integer
);

create table faction_members (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  faction_id  integer not null references factions(id) on delete cascade,
  resident_id integer not null,
  joined_day  integer not null,
  left_day    integer,
  loyalty     integer not null default 50,
  unique (world_id, faction_id, resident_id)
);

create table civic_offices (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  office      text    not null,
  seat        integer not null default 0,
  holder_id   integer,
  since_day   integer not null,
  until_day   integer,
  unique (world_id, office, seat)
);

create index civic_offices_office on civic_offices (world_id, office, until_day);

create table elections (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  day         integer not null,
  office      text    not null,
  results_json text   not null,
  winner_id   integer
);

create table civic_policies (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  policy      text    not null,
  value_json  text    not null,
  set_day     integer not null,
  set_by      integer,
  unique (world_id, policy)
);

create table unrest (
  id             integer primary key autoincrement,
  world_id       integer not null references worlds(id) on delete cascade,
  kind           text    not null,
  started_day    integer not null,
  ended_day      integer,
  demands_json   text,
  participants_json text,
  status         text    not null default 'active',
  severity       integer not null default 1
);

create index unrest_active on unrest (world_id, status);

create table grievances (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  resident_id integer not null,
  kind        text    not null,
  severity    integer not null default 0,
  since_day   integer not null,
  until_day   integer,
  reason      text
);

create index grievances_resident on grievances (world_id, resident_id, until_day);

create table attacks (
  id            integer primary key autoincrement,
  world_id      integer not null references worlds(id) on delete cascade,
  attacker_id   integer not null,
  target_id     integer not null,
  day           integer not null,
  outcome       text    not null,
  injury_id     integer,
  witnesses_json text,
  fatal         integer not null default 0,
  case_id       integer
);

create table proposal_log (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  day         integer not null,
  from_id     integer not null,
  to_id       integer not null,
  kind        text    not null,
  status      text    not null default 'pending',
  expires_day integer not null,
  detail_json text
);

create index proposal_pending on proposal_log (world_id, to_id, status);
