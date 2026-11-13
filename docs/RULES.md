# Tidehaven Rules — authoritative numeric contract

Everything here is initially seeded from `config/defaults.json` and `scenarios/tidehaven.json` and is
stamped into `rules_versions` (a `RULES_VERSION` string plus a hash of the scenario JSON). Changing a
number is a rules-version bump; existing saves keep the version they were created with.

All money is **integer minor units** (`cents`; 100 cents = 1 "unit" for display). All goods are
integer units. Percentages are integers in basis points (bps; 10 000 bps = 100 %). Probabilities are
integers in parts per million (ppm) per day. No floating-point values exist in domain state.

## 1. Calendar and time

| Item | Value |
|---|---|
| Day | one simulated day = one turn |
| Year | 365 days, no leap years (toy calendar) |
| Adulthood | 18 years = **6 570 days** |
| Elder | 65 years = 23 725 days |
| Pregnancy | 280 days |
| Week | day 1..7 cycles; shipping every 7th day |

Day counter starts at 1. `dayIndex` is authoritative; wall-clock is never used for domain decisions.

## 2. Subphase order (fixed; each phase sees the previous phase's committed effects)

1. `recover` — finish/find incomplete turn, apply queued operator settings + interventions, freeze
   day number, rules version, RNG seed material, and starting state hash.
2. `schedule` — birthdays/aging, pregnancy due dates, sentence and case timers, health progression
   timers, contract expiry, hazard opportunity rolls (weather/disaster candidates).
3. `observe` — build per-actor observations (public facts, own accounts, contacts, witnessed events).
4. `collect` — persist the job manifest; gather one structured plan per eligible adult.
5. `dialogue` — up to 2 reciprocal rounds for at most 4 conversations/day.
6. `protect` — protective care, evacuation, emergency shelter, relief.
7. `household` — household agreements: partnership, separation, conception, intra-household transfers.
8. `labour` — residents' job applications and resignations, then automatic hires and layoffs,
   strike effects on available labour.
9. `produce` — labour + inputs → outputs per recipe; spoilage.
10. `market` — household provisioning (default basket), buy/sell order matching, price updates.
11. `civic` — taxes/public spending, elections, faction actions, petitions.
12. `conflict` — theft, fraud, corruption, assault, unrest escalation (validated, seeded outcomes).
13. `justice` — reports → cases → investigation → trial → sentence → prison/release timers.
14. `health` — disease transmission/progression, treatment, injury, recovery, death resolution.
15. `demography` — mortality checks already resolved in `health`; ageing applied in `schedule`;
    this phase settles deaths, estates, guardianship, migration, population pressure.
16. `trade` — weekly external shipping (imports/exports) and external account settlement.
17. `commit` — invariants, canonical hash, atomic commit, `day_committed` notification.
18. `present` — optional newspaper/reflection jobs from committed evidence (may be skipped under load).

A plan may contain: 1 primary action (work/civic), 1 social action, and up to 4 market orders.
Invalid or conflicting entries are rejected individually with a recorded reason; a rejected entry
never invalidates the rest of the plan.

## 3. Starting town

Exactly **25 residents**, 5 households, mixed ages:

| Cohort | Count | Ages (days) |
|---|---|---|
| Children | 5 | 900–6 200 |
| Young adults | 6 | 6 600–11 000 |
| Adults | 9 | 11 000–19 000 |
| Elders | 5 | 24 000–30 000 |

- Population soft target: **120** (default). Host safety ceiling: **500** living residents.
- Labour capacity per day: adult 100 labour points (lp), elder 50 lp, child 0 lp.
  One full worker-day = 100 lp. Labour is allocated in lp and converted to recipe batches.
- Every resident needs **25 lp-equivalents**? No — consumption is `food`: **1 food unit/day**
  (children 1, adults 1, elders 1). Food = any of `grain`, `bread`, `fish`, 1 unit each.
- Household reserves: each household starts with 21 days of food per member and 2 000 cents cash.
- Treasury: 40 000 cents; resident-owned businesses 5 000 cents each; town businesses 2 000 each.
- External credit line: the outside world buys at most **2 000 000** cents worth before it stops buying.

## 4. Goods and recipes

Goods: `grain`, `fish`, `bread`, `timber`, `tools`, `medicine`, `cloth`.
All foods are interchangeable for the `food` need at 1 unit each; bread is a grain value-add.

Recipes (per **100 lp** of applied labour, i.e. one full worker-day):

| Business | Inputs | Outputs | Wage class |
|---|---|---|---|
| Farm | — | 8 `grain` | unskilled |
| Fishery | — | 6 `fish` | unskilled |
| Bakery | 2 `grain` | 8 `bread` | skilled |
| Timber camp | — | 5 `timber` | unskilled |
| Workshop | 1 `timber` | 2 `tools` | skilled |
| Clinic | 1 `medicine` | 4 treatment slots | skilled |
| Shop | — | retail service (fee) | unskilled |
| Guard house | — | 2 security slots | skilled |
| Court / Council | — | 1 case/day, governance | official |
| Public works (Town Yard) | — | repairs the worst building (+60 bps/day) | unskilled |

Partial labour: output = `floor(lp_applied * outputPer100lp / 100)`, remainder lost (integer-only).
A recipe is skipped when inputs are missing; the job records `blocked`.

Spoilage: `fish` 150 bps and `bread` 150 bps of stock per day when stock exceeds 1 unit.

Town-owned staple trades: farm, fishery, bakery, shop, clinic, guard, court and the Town Yard are owned
by the town and their surplus is paid to the treasury. A household that cannot afford its staple food
takes the shortfall from town stock and pays what it can (the treasury covers the rest) — the **granary**
rule. This is why a poor household does not starve beside a full store.

## 5. Prices (initial reference, cents per unit)

| Good | Reference | Import cost | Export price |
|---|---|---|---|
| grain | 120 | 150 | 90 |
| fish | 180 | 220 | 130 |
| bread | 150 | 190 | 110 |
| timber | 200 | 240 | 150 |
| tools | 900 | 1 050 | 700 |
| medicine | 700 | 800 | 520 |
| cloth | 400 | 460 | 300 |

Market prices move by at most 8 % per day toward clearing and are bounded to **70 %–150 %** of the
reference price. Buy limits track the live price (households bid at least 1.15× the current price, business
input orders at least 1.25×), so a capped price can never deadlock trade.

Wages (per worker-day): unskilled **420**, skilled **520**, official **600**. Pay is proportional to the
labour actually supplied (`wage × lp / 100`). A worker keeps a **10 %** personal allowance; the rest is
paid to their household. Personal balances above **3 000** cents are moved into the household at market
time, so nobody starves while holding pocket money.

Choosing work. Residents pick their own workplace; automatic hiring fills what they leave open:

- `seek_work` with `businessId` applies to that business, before automatic hiring each day. It is
  accepted when the business is open, its premises are usable (not private, not destroyed, condition at
  least 30 %), it has a free place, the applicant is a living, non-imprisoned adult, and the payer
  (business, or treasury for town services) holds at least 5 days of the wage. An employed applicant
  who is accepted switches jobs in one step; one who is refused keeps their current job. Applications
  resolve in resident-id order, so the last free place is never decided by the order replies arrived.
- `quit_job` ends the current job that day. Neither automatic hiring nor the Town Yard re-hires that
  resident the same day.
- `seek_work` without a business, or no work action at all, leaves placement to automatic hiring.
- Adults see a public JOB BOARD in their prompt: up to 12 open workplaces with free places, the daily
  wage and the current shortage of their goods, most-needed first.

Employment rules: businesses hire when their output is in shortage (or revenue supports the wage) and
their cash covers five days of wages; they release their newest worker when revenue cannot cover a third
of the wage bill; the council provides a **public-works job guarantee** at the Town Yard when the
treasury holds at least twenty days of unskilled wages.

## 6. Taxes, public finance

- Income tax: default **1 200 bps** (12 %) of wages, capped at **2 500 bps** by the charter.
- Business levy: **1 500 bps** of market and export proceeds.
- Retail fee: **800 bps** of household purchases, paid to the shop.
- Child allowance: **60 cents per child per day**, paid by the treasury.
- Citizens' dividend: when the treasury exceeds **200 000** cents, every resident receives **300** cents
  per week (bounded so the treasury keeps a reserve).
- Wealth levy: **100 bps per week** on household cash above **20 000** cents.
- Public payroll: bounded at 40 % of the treasury per day; the treasury cannot go negative.
- Clinic fee 300 cents per treated case, court fee 200 cents per trial (patient/defendant first, then the
  treasury as relief).
- Elections: every 365 days, 3 council seats plus magistrate, guard captain and clerk; vacancies are
  filled at the next boundary. Elections use standing (diligence, honesty, education, feuds, grievances)
  with a seeded per-voter wobble.
- Rebellion thresholds: ≥ 25 % of adults with grievance ≥ 60 for 30 consecutive days, one faction with
  ≥ 40 % support, and legitimacy ≤ 3 500. Resolution within 30 days by negotiation, concession or a
  bounded authority change; property and offices are preserved.

## 7. Households, relationships, consent

- Partnership/marriage requires: both adults (≥ 6 570 days), unrelated (two ancestor generations:
  no parent/child, grandparent/grandchild, sibling, avuncular, or first-cousin pair), both alive and
  free (no existing partnership unless the intent is an affair), housing capacity (a spare place, or a
  vacant home for a new household), and **reciprocal consent**:
  the same `pairEligibility()` validator runs at proposal *and* at acceptance, so a stale proposal
  (dead proposer, changed partnership, lost capacity) is refused rather than silently honoured:
  a proposal is accepted only if the target issues an `accept` action in the same day (dialogue) or
  was proposed to and accepted within the previous 2 days. Silence is refusal. Refusal cooldown:
  10 days for that pair.
- Affairs: same eligibility minus "free" — requires mutual consent, creates private evidence with
  probability `2000 ppm/day` of discovery per participant per day, affected by location privacy.
- Conception: both partners adults, in a partnership or affair, both explicit, female age ≤ 45 years
  (16 425 days), no active pregnancy, household food security above `food_days ≥ 3`, the soft target
  and the hard host ceiling (protected-birth capacity).
  Probability per eligible day: `2500 ppm` base, +1 500 ppm per 1 000 days of female age below 35 000,
  capped at 6 000 ppm.
- Divorce/separation: assigns residence to the party with the greater household income share,
  dependents stay with the primary caregiver, assets split by `contribution share` rounded with
  integer remainder to the lower-ID party; disputes go to a court case (see §10).
- Wills and estates: recorded lawful obligations (unpaid fines/restitution) are paid to creditors
  first; a recorded will then disposes of the **distributable remainder** in basis points; otherwise
  the partner takes half and living descendants split the rest, with the remainder to the treasury.
  A will that leaves a natural heir with nothing is **disputed**: the estate stays escrowed, a case is
  opened, and the court rules by a recorded deadline (10 days). A minor heir's share is held in a
  separate protected trust account that a guardian cannot spend, released on the day the heir comes of
  age. Death and emigration close employment, offices, partnerships, and remaining asset ties through
  one shared departure lifecycle.
- Recorded wills are written with the `write_will` primary action (heir id + basis-point share), and
  `found_business` / `migrate` primary actions execute in the daily pipeline.

## 8. Health and mortality

Health states: `healthy`, `exposed`, `infectious`, `recovering`, `injured`, `disabled`, `dead`.

Mortality hazard, base ppm/day by band, multiplied by active condition multipliers
(infectious ×2, untreated serious ×3, injury ×2, disabled ×2, famine ×2), capped at 200 000 ppm.

| Band | Days | Base ppm/day |
|---|---|---|
| child | 0–6 569 | 40 |
| adult | 6 570–23 724 | 60 |
| elder | 23 725–29 199 | 800 |
| very old | ≥ 29 200 | 3 000 |

Death is only ever produced by this resolver (natural), or by a validated injury/attack/disaster
resolution that routes through it with a raised multiplier. Models may *attempt* harm; they can
never set `dead` directly. No mortality increase is permitted to satisfy a population target.

Disease model: per-disease `transmissionPpm` scaled by location contact count, infectious duration
`7–14 days` seeded, treatment requires 1 clinic slot + 1 `medicine` per 3 days, recovery without
treatment at `60 %` rate of treated recovery speed.

## 9. Crime, evidence, justice

- Theft requires: valid target stock > 0, access (same location or employee/household relation),
  actor has `desperate` or `greedy` trait-weighted motive roll ≥ 400 ppm, and a successful skill
  contest (`basis points`: 4 500 base, +200 per stealth skill, +800 for household access, clamped to
  300–9 500). Max stolen = `min(target stock, 25 % of target stock)`; transfers real assets. Failures
  create witnesses with a `40 %` (public) / `8 %` (private) witness roll; a guard on patrol adds 15 %.
- Fraud/corruption require an office or business role and a traceable benefit; bounds: ≤ 5 % of the
  touched flow per day, always recorded as a transfer with a counterparty.
- Reports create an **allegation**, never guilt. Investigation consumes court capacity for 3–10 days
  and accumulates evidence weight. Trial compares `prosecution weight` vs `defence weight` with a
  seeded ±15 % noise; verdict: acquit, dismiss, fine, restitution, probation, imprisonment.
- Sentences: fine ≤ 20 000 cents, restitution ≤ stolen value, probation 30–180 days,
  imprisonment 10–120 days (clinic/jail capacity 3). Release on expiry is automatic and logged.
- Ground truth and public finding may differ; the dashboard labels both.

## 10. Disasters and public health events

Severity presets: `calm` (disaster chance ×0.5), `dramatic` (×1, default), `volatile` (×2).
Base daily hazard opportunities: storm 60 ppm, flood 20 ppm, fire 40 ppm, drought 15 ppm,
outbreak 25 ppm (scaled by preset and by season). A hazard damages specific buildings/assets within
an envelope (≤ 20 % of one business's stock, ≤ 5 injured residents), and injuries route through the
health resolver. Every event has preparation, response, and recovery/closure stages with durations.

## 11. Population soft target

Above target: no new immigration/conception approvals, housing and price pressure, emigration
pressure rises (`pressureDays` counter). After **30** unresolved pressure days the council may fund
household resettlement (≤ 1 household/day, dependants stay together). No fabricated deaths, no
deletion, no guaranteed deadline. Below target: immigration allowed when housing, care, and economic
capacity exist, with an explicit source/endowment transfer recorded.

Immigration cadence. Without an `immigration` block in the scenario, a newcomer may arrive on every
5th day and joins the household with the most room. A scenario may set
`immigration: { startDay, initialIntervalDays, minIntervalDays, stepDays }`. Then nobody arrives
before `startDay`. The first newcomer may arrive on that day, and the next one `initialIntervalDays`
later. Each later gap is `stepDays` shorter, but never shorter than `minIntervalDays`. Newcomers move
into a vacant home first; when no home is vacant, they join the household with the most room. The
counters are `immigrationArrivals` and `lastImmigrationDay`. `scenarios/eden.json` uses `90, 28, 7, 3`:
Adam and Eve are alone for 90 days, then the gaps are 28, 25, 22, … days, down to one week.

Home construction. A scenario may set `construction: { homeCapacity, labourDays, timberUnits,
fellPerDay, maxActiveSites, maxCamps }`. Then `build_home` is a primary action:

- A builder gives 70 % of the day's labour to a home site; the job keeps the other 30 %.
- A home needs `labourDays` adult person-days and `timberUnits` timber. The site takes timber as the
  work goes on: first from the builder's household stock, then bought at the market price from the
  public store or an open timber camp. The household pays first, then the builder. Nothing is bought
  on credit, and a timber camp sale pays the business levy. When no timber can be bought, the builder
  fells `fellPerDay` units by hand, and does no building work that day.
- A builder works on the household's own site. When it has none, the builder helps the oldest site,
  or starts a new one when fewer than `maxActiveSites` are active.
- A finished site becomes a `home` with `homeCapacity`. The camp that built it moves in. When that
  camp is gone, the oldest camp moves in. When there is no camp, the home stays free for the next
  newcomer or new couple.
- A newcomer who finds no free home starts a camp: a household with no building and capacity 1. Its
  endowment goes to the camp purse. Immigration waits while `maxCamps` camps exist.
- The safe-baseline plan builds only for a camping household. Every other decision to build is the
  resident's own choice. The resident prompt shows a `HOUSING` block in these scenarios only.

`scenarios/eden.json` starts with one cottage and uses `5, 12, 12, 2, 3, 5`.

Resource-funded growth. A scenario may set a `growth` block (see `src/contracts/growth.ts`). Then:

- **Population policy.** `populationPolicyEnabled: false` turns off the soft population target: it
  no longer blocks immigration or conception, and it causes no target pressure. The host safety
  ceiling still pauses the town. `TIDEHAVEN_POPULATION_POLICY` overrides this when a town is founded,
  and the dashboard Controls page can switch it at the next day boundary.
- **New workplaces.** `build_workplace` with `businessKind` starts a known template. The sponsor pays
  the materials, the construction cost (to the treasury) and the startup capital (into escrow) from
  their own account before any site appears. The site has capacity 0 and produces nothing.
  `work_construction` with the project ID adds labour. On completion the site becomes the workplace,
  a resident-owned business opens, and the startup capital moves into its account.
- **Extensions.** `expand_building` with `targetId` and `capacityDelta` adds capacity to a building,
  up to the template's `capacityCeiling`. A business owner can extend their own business. A member can
  extend their own home. A current councillor or magistrate can extend a town business with treasury
  funds. Permission, owner and capacity are checked again every day.
- **Materials.** Materials come from the sponsor first, then are bought at the market price from the
  treasury or an open producer. When none can be bought, the request is rejected and the missing
  quantity is added to the next shortage signal, so producers can hire.
- **Cancellation.** A project whose sponsor, permission or target becomes invalid is cancelled. The
  startup capital and the secured materials go back to the sponsor. When the sponsor is dead or gone,
  they go to the treasury, because the estate is already settled. The construction cost is not refunded.
- **Shared housing.** A single adult in a camp with no partner or dependants may `request_housing`
  with an adult host. Every current adult in the host household must `accept_housing` with the
  proposal ID. Refusal, silence, expiry, a changed adult roster, a full home or an imprisoned host
  stops the move. The move changes the household only, never a partnership. The camp's cash and goods
  move to the new household through the ledger; goods held for open orders block the move.
- **Safety limits.** `maxBuildings`, `maxBusinesses`, `maxActiveProjects`, `maxProjects` and
  `maxPendingHousingRequests` are finite, but they count only what is in use:
  - Buildings: standing buildings and active sites. Destroyed buildings and abandoned sites do not count.
  - Businesses: open businesses only. Closed and bankrupt businesses do not count.
  - Projects: active projects plus those closed within the last 365 days. Older closed projects leave
    the live state; their database row is kept with `archived = 1`, and their events stay in history.
  Eden uses 20000 buildings, 10000 businesses, 40 active projects, 10000 live projects, 128 pending
  housing requests, 20 home sites and 40 camps. None of these is a lifetime total.

## 12. Migration and schema policy

- SQLite, WAL, `foreign_keys=ON`, `busy_timeout=5000`, `defensive=ON`.
- Migrations are numbered files in `src/storage/migrations/NNN-name.sql`, applied in order inside a
  transaction each, recorded in `schema_migrations(version, name, checksum, applied_at)`.
- Applied migrations are immutable. A database whose `schema_version` is newer than the binary is
  refused (never "downgraded" silently). A backup is required before any migration that alters
  existing tables.
- World rows store `rules_version`; replay uses the stored rules version, not the current defaults.

## 13. Model budget defaults

| Setting | Default |
|---|---|
| concurrency | 8 |
| in-memory queue capacity | 256 |
| request timeout | 60 s |
| HTTP dispatches per job (incl. repair) | 3 |
| max input tokens / output tokens per decision | 3 000 / 800 |
| dialogue rounds / conversations per day | 2 / 4 |
| memories per actor prompt | 20 |
| reflections per day | ≤ 5 (important events or weekly) |
| terminal fallback rate pause threshold | 50 % over a day |

`null` ceilings mean "no spending ceiling", not "no safety bounds".
