-- Land added by completed reclamation projects. Append-only: a patch is never edited or removed, and
-- building placement depends on it, so the rows are authoritative world state.
create table reclaimed_land (
  world_id integer not null references worlds(id) on delete cascade,
  id integer not null,
  project_id integer not null,
  tx integer not null,
  ty integer not null,
  size integer not null check (size >= 1),
  from_building_id integer not null,
  completed_day integer not null,
  primary key (world_id, id)
);
