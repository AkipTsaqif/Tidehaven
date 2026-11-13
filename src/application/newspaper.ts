import type { TurnContext } from '../domain/turn-context.js';
import type { ArticleInsert } from '../storage/repositories.js';
import type { EventInsert } from '../storage/repositories.js';

/**
 * The daily newspaper. Built only from committed event ids: public facts, then labelled rumours. When
 * narration is unavailable (or skipped under load) the deterministic digest below is published — the
 * town never shows an unverifiable story as fact.
 */

export function buildNewspaperDigest(ctx: TurnContext, events: EventInsert[]): ArticleInsert {
  const publicEvents = events.filter((e) => e.visibility === 'public');
  const rumours = events.filter((e) => e.visibility === 'rumor' || e.visibility === 'secret');
  const important = publicEvents.slice().sort((a, b) => b.importance - a.importance);

  const headline =
    important[0]?.title ??
    `A quiet day in ${ctx.state.name}`;

  const lines: string[] = [];
  lines.push(`THE ${ctx.state.name.toUpperCase()} HERALD — day ${ctx.day}`);
  lines.push('');
  if (important.length === 0) {
    lines.push('Nothing of note was recorded in the town ledger today.');
  } else {
    lines.push('TODAY');
    for (const event of important.slice(0, 12)) {
      lines.push(`- ${event.title}${event.actorId === null ? '' : ` (resident ${event.actorId})`}`);
    }
  }
  const minor = publicEvents.length - important.slice(0, 12).length;
  if (minor > 0) lines.push(`- …and ${minor} smaller notices.`);
  if (rumours.length > 0) {
    lines.push('');
    lines.push('HEARD IN THE STREET (unverified)');
    for (const rumour of rumours.slice(0, 5)) {
      lines.push(`- Rumour: ${label(rumour)}`);
    }
  }
  lines.push('');
  lines.push('Market prices (cents): ' + Object.fromEntries(ctx.state.prices.entries()));
  lines.push('Reported facts only; allegations are not verdicts.');

  return {
    day: ctx.day,
    headline,
    body: lines.join('\n'),
    eventIds: events.map((e) => e.id),
    generatedBy: 'digest',
  };
}

function label(event: EventInsert): string {
  if (event.visibility === 'secret') return 'a private matter nobody has confirmed';
  return event.title;
}
