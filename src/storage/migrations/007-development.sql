-- Typed resource-funded projects are authoritative; progress must survive a restart.
create table construction_projects (
  world_id integer not null references worlds(id) on delete cascade,
  id integer not null,
  status text not null check (status in ('active', 'completed', 'cancelled', 'abandoned')),
  project_json text not null,
  primary key (world_id, id)
);
