import type { DevelopmentProject } from '../domain/development-types.js';
import type { WorldState } from '../domain/state.js';
import type { Db } from './database.js';

/**
 * Invoked inside the same short snapshot transaction as the rest of the authoritative world.
 * A project row absent from live state was retired by the engine: it is marked archived, never deleted,
 * so history keeps it while reloads and hashes see exactly the live set.
 */
export function saveDevelopment(db: Db, state: WorldState): void {
  for (const project of state.development.projects.values()) {
    db.run(
      'insert into construction_projects (world_id, id, status, project_json, archived) values (?, ?, ?, ?, 0) ' +
      'on conflict(world_id, id) do update set status = excluded.status, project_json = excluded.project_json, archived = 0',
      [state.worldId, project.id, project.status, JSON.stringify(project)],
    );
  }
  for (const row of db.all<{ id: number }>(
    'select id from construction_projects where world_id = ? and archived = 0', [state.worldId],
  )) {
    if (!state.development.projects.has(row.id)) {
      db.run('update construction_projects set archived = 1 where world_id = ? and id = ?', [state.worldId, row.id]);
    }
  }
  db.run('insert into system_flags (key, value_json, updated_at) values (?, ?, ?) ' +
    'on conflict(key) do update set value_json = excluded.value_json, updated_at = excluded.updated_at',
  [`developmentNextId:${state.worldId}`, JSON.stringify(state.development.nextId), new Date().toISOString()]);
}

/** Append-only: existing rows are never rewritten, so a patch can never be silently moved. */
export function saveReclaimed(db: Db, state: WorldState): void {
  const stored = db.get<{ n: number }>('select count(*) as n from reclaimed_land where world_id = ?', [state.worldId])?.n ?? 0;
  if (state.reclaimed.length < stored) throw new Error('Reclaimed land cannot shrink');
  for (const patch of state.reclaimed.slice(stored)) {
    db.run(
      'insert into reclaimed_land (world_id, id, project_id, tx, ty, size, from_building_id, completed_day) values (?, ?, ?, ?, ?, ?, ?, ?)',
      [state.worldId, patch.id, patch.projectId, patch.tx, patch.ty, patch.size, patch.fromBuildingId, patch.completedDay],
    );
  }
}

export function loadReclaimed(db: Db, state: WorldState): void {
  state.reclaimed = db.all<{ id: number; project_id: number; tx: number; ty: number; size: number; from_building_id: number; completed_day: number }>(
    'select id, project_id, tx, ty, size, from_building_id, completed_day from reclaimed_land where world_id = ? order by id', [state.worldId],
  ).map((row) => ({
    id: row.id, projectId: row.project_id, tx: row.tx, ty: row.ty, size: row.size,
    fromBuildingId: row.from_building_id, completedDay: row.completed_day,
  }));
}

export function loadDevelopment(db: Db, state: WorldState): void {
  for (const row of db.all<{ id: number; status: string; project_json: string }>(
    'select id, status, project_json from construction_projects where world_id = ? and archived = 0 order by id', [state.worldId],
  )) {
    const project = JSON.parse(row.project_json) as DevelopmentProject;
    if (project.id !== row.id || project.status !== row.status) throw new Error('Invalid persisted construction project');
    state.development.projects.set(project.id, project);
  }
  const row = db.get<{ value_json: string }>('select value_json from system_flags where key = ?', [`developmentNextId:${state.worldId}`]);
  state.development.nextId = row ? Number(JSON.parse(row.value_json)) : 1;
  if (!Number.isSafeInteger(state.development.nextId) || state.development.nextId < 1 ||
    [...state.development.projects.keys()].some((id) => id >= state.development.nextId)) {
    throw new Error('Invalid persisted construction project sequence');
  }
}
