import { describe, expect, it } from 'vitest';
import { seedTown } from '../fixtures/seed-town.js';
import { buildActorPrompt } from '../../src/model/prompts.js';
import { promptEventsFor, memoriesFor } from '../../src/application/observations.js';
import { residentDetail } from '../../src/application/queries.js';
import { livingResidents } from '../../src/domain/state.js';

/**
 * Actor privacy.
 *
 * A resident prompt may contain only that resident's own finances, their household, public/rumoured
 * events, and their own memories. Another resident's balance, a secret crime, or a private affair must
 * never appear — these are assertions about content, not about intent.
 */
describe('actor privacy', () => {
  it('never puts another resident’s balance or household cash in a prompt', async () => {
    const town = await seedTown({ seed: 'privacy' });
    const [actor, other] = livingResidents(town.state);
    expect(actor && other).toBeTruthy();
    if (!actor || !other) return;

    // Distinctive values that cannot appear by coincidence.
    town.state.accounts.set(`resident:${actor.id}`, {
      ownerType: 'resident',
      ownerId: actor.id,
      balanceCents: 111_111,
    });
    town.state.accounts.set(`resident:${other.id}`, {
      ownerType: 'resident',
      ownerId: other.id,
      balanceCents: 987_654,
    });
    const otherHousehold = other.householdId;
    if (otherHousehold !== null && otherHousehold !== actor.householdId) {
      town.state.accounts.set(`household:${otherHousehold}`, {
        ownerType: 'household',
        ownerId: otherHousehold,
        balanceCents: 765_432,
      });
    }

    const prompt = buildActorPrompt({
      state: town.state,
      scenario: town.scenario,
      resident: actor,
      day: town.state.day,
      memories: [],
      events: [],
      maxBytes: 100_000,
      maxRecords: 20,
    });
    const text = `${prompt.system}\n${prompt.user}`;
    expect(text).toContain('111111');
    expect(text).not.toContain('987654');
    if (otherHousehold !== null && otherHousehold !== actor.householdId) {
      expect(text).not.toContain('765432');
    }
    town.db.close();
  }, 30_000);

  it('filters secret crimes, private affairs, and private details out of prompt events', async () => {
    const town = await seedTown({ seed: 'privacy-events' });
    const worldId = town.worldId;
    const day = town.state.day;
    const insert = (kind: string, visibility: string, title: string): void => {
      town.db.run(
        `insert into events (world_id, day, phase, kind, actor_id, target_id, location_id, visibility,
                             importance, title, detail_json, cause_ids_json, effect_ids_json, created_at)
         values (?, ?, 'fixture', ?, null, null, null, ?, 50, ?, '{}', '[]', '[]', ?)`,
        [worldId, day, kind, visibility, title, new Date().toISOString()],
      );
    };
    insert('theft', 'secret', 'SECRET-THEFT-TITLE');
    insert('affair_started', 'secret', 'SECRET-AFFAIR-TITLE');
    insert('proposal_made', 'private', 'PRIVATE-PROPOSAL-TITLE');
    insert('birth', 'public', 'PUBLIC-BIRTH-TITLE');
    insert('rumour', 'rumor', 'RUMOUR-TITLE');

    const events = promptEventsFor(town.db, worldId, day);
    const titles = events.map((event) => event.title).join('\n');
    expect(titles).toContain('PUBLIC-BIRTH-TITLE');
    expect(titles).toContain('RUMOUR-TITLE');
    expect(titles).not.toContain('SECRET-THEFT-TITLE');
    expect(titles).not.toContain('SECRET-AFFAIR-TITLE');
    expect(titles).not.toContain('PRIVATE-PROPOSAL-TITLE');

    // Memories are per-resident: one resident's memory never appears in another's list.
    town.db.run(
      `insert into memories (world_id, resident_id, day, kind, text, importance, source_event_ids, created_at)
       values (?, ?, ?, 'insight', 'ONLY-OTHER-KNOWS', 50, '[]', ?)`,
      [worldId, 999_999, day, new Date().toISOString()],
    );
    expect(memoriesFor(town.db, worldId, 1, 50).map((m) => m.text)).not.toContain('ONLY-OTHER-KNOWS');
    town.db.close();
  }, 30_000);

  it('returns only the requested resident’s own detail from the dashboard query', async () => {
    const town = await seedTown({ seed: 'privacy-detail' });
    const [actor, other] = livingResidents(town.state);
    if (!actor || !other) return;
    town.db.run(
      `insert into memories (world_id, resident_id, day, kind, text, importance, source_event_ids, created_at)
       values (?, ?, 1, 'insight', 'OTHER-PRIVATE-MEMORY', 50, '[]', ?)`,
      [town.worldId, other.id, new Date().toISOString()],
    );
    const detail = residentDetail(town.db, town.worldId, actor.id) as {
      id: number;
      memories: { text: string }[];
    };
    expect(detail.id).toBe(actor.id);
    expect(detail.memories.map((m) => m.text)).not.toContain('OTHER-PRIVATE-MEMORY');
    town.db.close();
  }, 30_000);
});
