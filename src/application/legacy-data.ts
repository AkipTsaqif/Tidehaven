import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, defaultDataRoot, type AppConfig } from '../config.js';

/**
 * Data used to live directly in `<project>/data`; the default is now `<project>/data/<scenario>`.
 *
 * A town left at the old location must not be silently replaced by a fresh town in the new default
 * folder. When the default is in use, the new folder holds no town, and a town file sits at the old
 * location, refuse with exact move instructions. Nothing is moved automatically: the user's saved town
 * is never touched by this check.
 */
export function assertNoLegacyTown(config: AppConfig): void {
  if (config.dataDirExplicit) return;
  const legacyRoot = defaultDataRoot(config.projectRoot);
  const legacyDb = join(legacyRoot, 'tidehaven.sqlite');
  if (!existsSync(legacyDb)) return;
  if (existsSync(join(config.dataDir, 'tidehaven.sqlite'))) return;
  throw new ConfigError(`A saved town is still at the old data location ${legacyRoot}`, [
    `Data now defaults to ${config.dataDir} (one folder per scenario).`,
    `Stop Tidehaven, then move the town's files (tidehaven.sqlite*, world.json, pause.json, backups/,`,
    `checkpoints/, archives/, logs/) from ${legacyRoot} into the scenario folder it was founded with,`,
    `e.g. ${join(legacyRoot, 'tidehaven')}.`,
    `Or keep it where it is by setting TIDEHAVEN_DATA_DIR=${legacyRoot}.`,
  ]);
}
