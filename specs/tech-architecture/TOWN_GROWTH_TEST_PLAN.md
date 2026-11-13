# Town growth acceptance tests

**type:** test-plan
**context:** domain

## P0 — conservation, consent and durability

1. Resource-funded expansion: reject unavailable actor/owner, invalid template, missing timber,
   insufficient capital, unsafe integer, duplicate target, and entity/project ceilings. Record
   labour/material/capital flows and rejection reasons. No output or capacity before completion.
2. Production: fill the original farm, show no further hire at its old capacity, complete an
   expansion or another farm, employ additional eligible adults, and prove food output rises through
   the actual production pipeline. More buildings with no workers must not manufacture food.
3. Household sharing: an explicit adult request plus agreement from every current adult host is
   necessary. Silence, refusal, stale request, death/departure, changed host roster, dissolved home,
   and filled last bed must not move anyone. Competing admissions cannot overfill a home.
4. Sharing never changes partners, parentage or kinship eligibility. Requesting household members
   and minors must not be silently abandoned. Household asset handling remains funded and recorded.
5. Save/reload an incomplete project and pending housing request. Continue stored decisions before
   and after reload and compare final canonical hashes. Reverse decision insertion order as well.
6. Disable the soft target explicitly: immigration and conception are not blocked at 120, while the
   finite host safety ceiling and protected-birth capacity checks still work. Old numeric target
   behavior remains covered; target zero must not mean unlimited.
7. Migrations preserve existing rows and numeric policy values. No test writes user data or .env.

## P1 — model observations, lifecycle and bounded work

1. Newcomers use consenting spare bedrooms; otherwise camp/build. A multi-person house is not
   automatically assigned to one immigrant forever. Sharing proposals and replies must have usable
   actor/household/project IDs in bounded private/public observations.
2. New workplaces need no vacant preseeded commercial premise, but must spend configured labour,
   materials and capital; only known recipes are allowed. Expansion permissions are rechecked.
3. Home expansion updates both building and attached household capacity. Workplace expansion uses
   the same authoritative capacity consumed by hiring. Sites are not usable premises until finished.
4. Camp and active-project backlog stays bounded; ownership/death/dissolution/destroyed-target
   behavior is explicit. No funds disappear, no held resources are duplicated on closure.
5. End-to-end scripted growing town demonstrates shared housing and more food production, daily
   invariants, durable restart and no manual generation of money or goods after founding.

## P2 — operator visibility and regression gates

1. UI/status/control distinguish 'no soft target' from a finite host population ceiling and entity
   limits; reject invalid safety values. Show project progress and occupancy.
2. `npm run verify` and the seven current e2e tests remain green; extend controls/browser coverage.
3. Keep old scenario rules hash and decision behavior stable unless a documented gameplay-version
   change is deliberate. Existing towns must never silently switch to the new scenario family.

## Environment

Use D: for TMP/TEMP and `PLAYWRIGHT_BROWSERS_PATH=D:\Projects\Tidehaven\.playwright`.
No paid provider requests. No external package is needed for this work.
