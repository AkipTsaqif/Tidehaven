-- 005-wills.sql — recorded wills.
--
-- A will is a durable instruction left by a living resident. Estate settlement consults it before the
-- intestate shares, and a will that disinherits a natural heir opens a court dispute rather than
-- silently overriding them.

create table wills (
  world_id     integer not null references worlds(id) on delete cascade,
  resident_id  integer not null,
  shares_json  text    not null,
  recorded_day integer not null,
  primary key (world_id, resident_id)
);

alter table estates add column dispute_deadline_day integer;
