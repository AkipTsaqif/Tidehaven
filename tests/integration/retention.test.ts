import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedTown } from '../fixtures/seed-town.js';
import { listArchives, readArchive, rehearsal, runRetention } from '../../src/application/retention.js';
import { checkGoodsLedger } from '../../src/domain/invariants.js';
import { loadConfig } from '../../src/config.js';
import { silentLogger } from '../../src/runtime/telemetry.js';

const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: 'D:/Projects/Tidehaven/data' } });

describe('retention and archives', () => {
  it('archives old detail, verifies it, and only then prunes', async () => {
    const town = await seedTown({ seed: 'retention' });
    for (let day = 1; day <= 20; day += 1) await town.step();
    // Detail rows that are safe to prune.
    for (let day = 1; day <= 20; day += 1) {
      town.db.run(
        `insert into observations (world_id, day, actor_id, event_id, visibility, summary, created_at)
         values (?, ?, 1, null, 'public', ?, ?)`,
        [town.worldId, day, `observation ${day}`, new Date().toISOString()],
      );
      town.db.run(
        `insert into memories (world_id, resident_id, day, kind, text, importance, source_event_ids, created_at)
         values (?, 1, ?, 'note', ?, 10, '[]', ?)`,
        [town.worldId, day, `memory ${day}`, new Date().toISOString()],
      );
    }
    const before =
      town.db.get<{ n: number }>('select count(*) as n from observations where world_id = ?', [town.worldId])?.n ?? 0;
    expect(before).toBeGreaterThan(0);
    const ledgerBefore =
      town.db.get<{ n: number }>('select count(*) as n from ledger_entries where world_id = ?', [town.worldId])?.n ?? 0;

    const dataDir = mkdtempSync(join(tmpdir(), 'tidehaven-retention-'));
    const result = runRetention({
      db: town.db,
      config: { ...config, dataDir },
      worldId: town.worldId,
      currentDay: town.state.day,
      logger: silentLogger(),
      keepDetailDays: 5,
    });

    expect(result.archivesWritten).toBe(1);
    expect(result.rowsArchived).toBeGreaterThan(0);
    expect(result.rowsDeleted).toBeGreaterThan(0);
    expect(result.bytesWritten).toBeGreaterThan(0);

    const archives = listArchives(dataDir);
    expect(archives.length).toBe(1);
    const check = readArchive(join(dataDir, 'archives', archives[0]!));
    expect(check.ok).toBe(true);

    const after =
      town.db.get<{ n: number }>('select count(*) as n from observations where world_id = ?', [town.worldId])?.n ?? 0;
    expect(after).toBeLessThan(before);
    // Recent detail is preserved.
    const recent = town.db.get<{ n: number }>(
      'select count(*) as n from observations where world_id = ? and day > ?',
      [town.worldId, town.state.day - 5],
    )?.n;
    expect(recent ?? 0).toBeGreaterThan(0);
    // Raw ledger rows inside the archived window are pruned after the archive verifies.
    const ledgerAfter =
      town.db.get<{ n: number }>('select count(*) as n from ledger_entries where world_id = ?', [town.worldId])?.n ?? 0;
    expect(ledgerAfter).toBeLessThan(ledgerBefore);
    // Goods reconciliation does not depend on the pruned rows: the running counters still balance.
    expect(checkGoodsLedger(town.state)).toHaveLength(0);

    const record = town.db.get<{ path: string; checksum: string }>(
      'select path, checksum from archives where world_id = ? order by id desc limit 1',
      [town.worldId],
    );
    expect(record?.checksum).toBe(check.checksum);
    rmSync(dataDir, { recursive: true, force: true });
  }, 60_000);

  it('does nothing when everything is inside the retention window', async () => {
    const town = await seedTown({ seed: 'retention-window' });
    for (let day = 1; day <= 3; day += 1) await town.step();
    const dataDir = mkdtempSync(join(tmpdir(), 'tidehaven-window-'));
    const result = runRetention({
      db: town.db,
      config: { ...config, dataDir },
      worldId: town.worldId,
      currentDay: town.state.day,
      logger: silentLogger(),
      keepDetailDays: 365,
    });
    expect(result.archivesWritten).toBe(0);
    expect(result.rowsDeleted).toBe(0);
    expect(listArchives(dataDir)).toHaveLength(0);
    rmSync(dataDir, { recursive: true, force: true });
  }, 30_000);

  it('passes an archive rehearsal in the data directory', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'tidehaven-rehearsal-'));
    const result = rehearsal(dataDir);
    expect(result.ok).toBe(true);
    rmSync(dataDir, { recursive: true, force: true });
  });
});
