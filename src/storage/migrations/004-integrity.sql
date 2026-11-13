-- 004-integrity.sql — idempotent effects, durable usage reservations.
--
-- Every append-only accounting stream gets a stable effect key derived from its contents, with a
-- uniqueness constraint. Replaying a committed payload therefore inserts nothing new instead of
-- duplicating ledger, flow, observation, memory, tax, or shipping rows.
--
-- Usage reservations are persisted before a billable dispatch and settled afterwards. A crash between
-- the two leaves the reservation open, which the tracker later treats as conservative spending rather
-- than forgetting that the request was made.

alter table ledger_entries add column effect_key text;
alter table goods_flows add column effect_key text;
alter table observations add column effect_key text;
alter table memories add column effect_key text;
alter table tax_records add column effect_key text;
alter table shipping_runs add column effect_key text;

-- A release is a one-time transition, not a recurring state. Recording the day makes the release
-- event idempotent across restarts.
alter table sentences add column released_day integer;

create unique index ledger_effect on ledger_entries (world_id, effect_key);
create unique index goods_flow_effect on goods_flows (world_id, effect_key);
create unique index observations_effect on observations (world_id, effect_key);
create unique index memories_effect on memories (world_id, effect_key);
create unique index tax_records_effect on tax_records (world_id, effect_key);
create unique index shipping_runs_effect on shipping_runs (world_id, effect_key);

create table usage_reservations (
  id          integer primary key autoincrement,
  world_id    integer not null references worlds(id) on delete cascade,
  day_key     text    not null,
  month_key   text    not null,
  requests    integer not null default 1,
  tokens      integer not null default 0,
  status      text    not null default 'reserved',
  created_at  text    not null,
  settled_at  text
);

create index usage_reservations_open on usage_reservations (world_id, status);
