import { scenarioSchema, type Scenario } from '../contracts/scenario.js';
import { ConfigError } from '../config.js';
import { hashValue } from '../domain/hash.js';
import type { Db } from '../storage/database.js';
import type { WorldRow } from '../storage/repositories.js';
import { validateScenarioConsistency } from './scenario.js';

/**
 * Current files select a scenario family; the snapshot that founded a saved world owns its rules.
 * Otherwise changing a recipe or a building template on disk would silently reinterpret stored turns.
 */
export function resumeScenario(db: Db, world: WorldRow, requested: Scenario): Scenario {
  const row = db.get<{ hash: string; scenario_json: string }>(
    'select hash, scenario_json from rules_versions where version = ?', [world.rulesVersion],
  );
  if (!row) throw new ConfigError('Stored scenario rules are missing; refusing to reinterpret this town', [world.rulesVersion]);
  let raw: unknown;
  try { raw = JSON.parse(row.scenario_json); }
  catch { throw new ConfigError('Stored scenario snapshot is not valid JSON', [world.rulesVersion]); }
  if (hashValue(raw) !== row.hash) throw new ConfigError('Stored scenario snapshot checksum mismatch', [world.rulesVersion]);
  const parsed = scenarioSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError('Stored scenario rules are invalid for this build', [world.rulesVersion]);
  if (parsed.data.version !== requested.version) {
    throw new ConfigError(`Saved scenario "${parsed.data.version}" does not match requested scenario "${requested.version}"`, [
      'Use the original scenario or a separate TIDEHAVEN_DATA_DIR. The saved town has not been reset.',
    ]);
  }
  validateScenarioConsistency(parsed.data);
  // Parsing must not silently add defaults that alter a legacy snapshot's canonical rules.
  if (hashValue(parsed.data) !== row.hash) throw new ConfigError('Stored scenario rules require an explicit version upgrade', [world.rulesVersion]);
  return parsed.data;
}
