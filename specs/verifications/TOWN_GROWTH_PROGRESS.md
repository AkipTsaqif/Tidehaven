# Town growth — verification evidence

**type:** verification
**context:** domain
**status:** implemented, offline-verified

## Gates (temp on D:, local .playwright browsers)

- `npm run verify`: PASS — 31 files / 184 tests, typecheck, lint, production build.
- `npm run test:e2e`: PASS — 7 browser tests.
- Legacy `scenarios/tidehaven.json` rules hash unchanged: `tidehaven-1:6aec47e672b1`.

## Behaviour proven by tests

- `growth-policy.test.ts` (4): disabled policy removes target pressure and conception block; host
  ceiling still applies; flag persists with legacy-compatible hashes; boundary control queues.
- `housing-sharing.test.ts` (5): unanimous current adult consent; refusal, silence, death, roster
  change, full bed and expiry block the move; partners unchanged; deterministic; persists.
- `workplace-growth.test.ts` (6): funded site has zero capacity until complete; completion opens a
  funded business; expanded farm output control 44 / empty expansion 20 / staffed 72 grain; bought
  materials refund to the payer; dead sponsor's refund goes to the treasury.
- `hiring-capacity.test.ts` (4), `saved-scenario.test.ts` (2), `development-persistence.test.ts` (2),
  `growth-contracts.test.ts` (2), `town-growth.test.ts` (1): integrated Eden run with consented sharing,
  civic farm extension, reloads with identical hashes and daily invariants.

## Offline 365-day Eden run (scripted residents, hosts always accept)

day 73: 2 people / 1 home; day 219: 9 / 2; day 292: 19 / 4; day 365: 30 / 6. 28 arrivals, 23 shared
moves, 5 homes built, no hunger, no invariant failures. Hosts accepting every request is a test
stand-in; the real model decides.

## Bugs found and fixed during review

1. Bought materials were refunded to the seller on cancellation (the sponsor lost goods paid for).
2. A dead sponsor's refund went to their already-settled account and was stranded.
3. A dashboard heading rename broke an existing browser test; restored alongside the new policy panel.

The independent reviewer subagent hit its turn limit without output; the review above was done directly.
