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
