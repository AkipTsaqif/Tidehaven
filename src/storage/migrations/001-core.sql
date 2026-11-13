-- 001-core.sql — world, time, jobs, audit/event spine, usage, storage bookkeeping.
-- All money columns are integer minor units (cents). All probabilities are integer ppm/bps.
-- Idempotent DDL is not used: migrations are applied exactly once, in order, inside a transaction.

create table schema_migrations (
  version     integer primary key,
  name        text    not null,
  checksum    text    not null,
  applied_at  text    not null
);

create table rules_versions (
  version        text primary key,
  hash           text not null,
  scenario_json  text not null,
  created_at     text not null
);

create table worlds (
  id                integer primary key autoincrement,
  name              text    not null,
  seed              text    not null,
  created_at        text    not null,
  rules_version     text    not null references rules_versions(version),
  drama             text    not null default 'dramatic',
  population_target integer not null,
  host_ceiling      integer not null,
  current_day       integer not null default 0,
  phase             text    not null default 'idle',
  state_hash        text,
  config_json       text    not null
);

create table turns (
  id                 integer primary key autoincrement,
  world_id           integer not null references worlds(id) on delete cascade,
  day                integer not null,
  phase              text    not null,
  input_hash         text    not null,
  rules_version      text    not null,
  schema_version     integer not null,
  prepared_json      text,
  state_hash_before  text,
  state_hash_after   text,
  started_at         text    not null,
  committed_at       text,
  duration_ms        integer,
  metrics_json       text,
  unique (world_id, day)
);

create table jobs (
  id                 integer primary key autoincrement,
  world_id           integer not null references worlds(id) on delete cascade,
  day                integer not null,
  phase              text    not null,
  actor_id           integer not null,
  job_kind           text    not null,
  status             text    not null,
  priority           integer not null default 0,
  attempts           integer not null default 0,
  request_json       text,
  result_json        text,
  fallback_reason    text,
  error_class        text,
  latency_ms         integer,
  prompt_tokens      integer not null default 0,
  completion_tokens  integer not null default 0,
  provider_request_id text,
  created_at         text    not null,
  updated_at         text    not null,
  unique (world_id, day, phase, actor_id, job_kind)
);

create index jobs_pending on jobs (world_id, day, status);
create index jobs_actor on jobs (world_id, actor_id, day);

create table model_attempts (
  id               integer primary key autoincrement,
  job_id           integer not null references jobs(id) on delete cascade,
  attempt_no       integer not null,
  status           text    not null,
  http_status      integer,
  latency_ms       integer,
  request_bytes    integer,
  response_bytes   integer,
  prompt_tokens    integer,
  completion_tokens integer,
  error_class      text,
  capability       text,
  model            text,
  prompt_version   text,
  schema_version   integer,
  created_at       text    not null
);

create index model_attempts_job on model_attempts (job_id);

create table operator_commands (
  id            integer primary key autoincrement,
  world_id      integer not null references worlds(id) on delete cascade,
  kind          text    not null,
  payload_json  text    not null,
  status        text    not null,
  requested_at  text    not null,
  applied_at    text,
  applied_day   integer,
  error         text
);

create index operator_commands_pending on operator_commands (world_id, status);

create table settings_history (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  key         text    not null,
  value_json  text    not null,
  source      text    not null,
  changed_at  text    not null,
  applied_day integer
);

create table events (
  id              integer primary key autoincrement,
  world_id        integer not null references worlds(id) on delete cascade,
  day             integer not null,
  phase           text    not null,
  kind            text    not null,
  actor_id        integer,
  target_id       integer,
  location_id     integer,
  visibility      text    not null default 'public',
  importance      integer not null default 0,
  title           text    not null,
  detail_json     text,
  cause_ids_json  text,
  effect_ids_json text,
  created_at      text    not null
);

create index events_day on events (world_id, day);
create index events_kind on events (world_id, kind, day);
create index events_actor on events (world_id, actor_id, day);

create table event_links (
  id             integer primary key autoincrement,
  world_id       integer not null references worlds(id) on delete cascade,
  from_event_id  integer not null references events(id) on delete cascade,
  to_event_id    integer not null references events(id) on delete cascade,
  relation       text    not null
);

create index event_links_from on event_links (from_event_id);

create table observations (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  day         integer not null,
  actor_id    integer not null,
  event_id    integer references events(id) on delete cascade,
  visibility  text    not null,
  summary     text    not null,
  created_at  text    not null
);

create index observations_actor_day on observations (world_id, actor_id, day);

create table memories (
  id               integer primary key autoincrement,
  world_id         integer not null references worlds(id) on delete cascade,
  resident_id      integer not null,
  day              integer not null,
  kind             text    not null,
  text             text    not null,
  importance       integer not null default 0,
  source_event_ids text,
  created_at       text    not null
);

create index memories_resident on memories (world_id, resident_id, day);
create index memories_importance on memories (world_id, resident_id, importance);

create table articles (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  day         integer not null,
  headline    text    not null,
  body        text    not null,
  event_ids_json text not null,
  generated_by text   not null,
  created_at  text    not null,
  unique (world_id, day)
);

create table daily_metrics (
  id           integer primary key autoincrement,
  world_id     integer not null references worlds(id) on delete cascade,
  day          integer not null,
  metrics_json text    not null,
  state_hash   text    not null,
  unique (world_id, day)
);

create table checkpoints (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  day         integer not null,
  path        text    not null,
  hash        text    not null,
  bytes       integer not null,
  created_at  text    not null
);

create table archives (
  id            integer primary key autoincrement,
  world_id      integer not null references worlds(id) on delete cascade,
  from_day      integer not null,
  to_day        integer not null,
  path          text    not null,
  checksum      text    not null,
  bytes         integer not null,
  manifest_json text    not null,
  created_at    text    not null
);

-- Usage accounting survives restarts; period keys look like 'day:2026-11-11' / 'month:2026-11'.
create table usage_counters (
  world_id    integer not null references worlds(id) on delete cascade,
  period_key  text    not null,
  requests    integer not null default 0,
  tokens      integer not null default 0,
  estimate_only integer not null default 0,
  updated_at  text    not null,
  primary key (world_id, period_key)
);

-- Provider/model capability probe cache, one row per profile.
create table provider_profiles (
  profile_key      text primary key,
  base_url         text    not null,
  model            text    not null,
  capability       text    not null,
  probed_at        text    not null,
  detail           text
);

-- Canonical single-row index for the running system's health.
create table system_flags (
  key         text primary key,
  value_json  text not null,
  updated_at  text not null
);
