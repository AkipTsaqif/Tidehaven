import type { Db } from '../storage/database.js';
import type { DevelopmentProject } from '../domain/development-types.js';

/** Dashboard observer projection; never pass this full list to a resident prompt. */
export function developmentQuery(db: Db, worldId: number) {
  const rows = db.all<{ project_json: string }>(
    'select project_json from construction_projects where world_id = ? order by id desc limit 50', [worldId],
  );
  return rows.map((row) => {
    const project = JSON.parse(row.project_json) as DevelopmentProject;
    return {
      id: project.id, kind: project.kind, status: project.status,
      businessKind: project.businessKind, buildingId: project.targetBuildingId,
      sponsorId: project.sponsorId,
      labourPct: project.requiredLabour > 0 ? Math.floor(project.appliedLabour * 100 / project.requiredLabour) : 0,
      capacityDelta: project.capacityDelta,
    };
  });
}
