-- Retired development projects leave live state but stay on disk for history.
alter table construction_projects add column archived integer not null default 0;
create index construction_projects_live on construction_projects (world_id, archived);
