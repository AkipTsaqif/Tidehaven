# Provider setup

Tidehaven talks to any endpoint that implements a narrow subset of the OpenAI Chat Completions API.
There is no SDK dependency and no streaming: one POST per decision, JSON in, JSON out.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `TIDEHAVEN_API_BASE_URL` | yes | API root; the client appends `/chat/completions` unless the URL already ends with it. Usually `https://host/v1`. |
| `TIDEHAVEN_API_KEY` | for remote | Bearer token. May be empty only for a loopback endpoint that needs no auth. |
| `TIDEHAVEN_MODEL` | yes | Exact model id. Never guessed, never switched automatically. |
| `TIDEHAVEN_CAPABILITY` | no | Force `json_schema`, `json_object`, or `plain_json`. Otherwise the client starts at `json_object` and degrades on a 400. |

A plain `http://` URL is refused unless it points at loopback — credentials must not travel in the clear.

## What is sent

For every eligible adult, once per simulated day:

- a fixed system prompt (resident, in-world, JSON only),
- a bounded user prompt: identity, household, work, relationships, prices, recent public events, own
  memories (cap 20 records), and the legal action vocabulary,
- `max_tokens` = 800, `temperature` ≈ 0.7,
- `response_format`: `json_schema` (strict) → `json_object` → none (plain JSON), depending on the
  provider's capability profile.

Request bodies are capped at 24 KiB of prompt text; responses above 256 KiB are discarded.

## What comes back and how it is treated

The model returns a JSON plan:

```json
{
  "primary": { "kind": "work" },
  "social": { "kind": "courtship", "targetId": 7 },
  "orders": [{ "good": "bread", "side": "buy", "quantity": 3, "limitPriceCents": 160 }],
  "intents": [{ "kind": "theft", "targetId": 4, "good": "grain", "quantity": 2 }],
  "summary": "One short sentence."
}
```

It is **data**, not instructions:

1. The text is parsed into a single JSON object (no regex scraping, no code execution).
2. Zod validates shape, enums, ranges, and array bounds. Unknown action names are rejected.
3. The engine re-checks permissions: money, stock, kinship, consent, office, phase, and capacity.
4. Rejected entries are recorded with a reason; they never abort the day.

If the provider supports neither schema nor JSON mode, the client sends the schema in the prompt text and
validates locally. Fenced JSON is extracted with a balanced-brace scanner, not a greedy regex.

## Failure handling

| Symptom | Behaviour |
|---|---|
| 401/403 | job falls back; runner pauses (`authentication`) until you fix the key and resume |
| 429 | honours `Retry-After` (capped at 5 min), then retries within the dispatch budget |
| 5xx / timeout / network | bounded exponential backoff, then fallback |
| 400 mentioning `response_format` | capability profile degrades one step, cached in the database |
| Malformed / non-JSON content | one repair request (echo + error), then fallback |
| `finish_reason = length` | treated as truncated; fallback |
| Refusal / empty content | fallback |
| Terminal fallback rate over 50% of a day | runner pauses (`provider_down`) rather than simulating years without the model |

Fallbacks are the safe baseline: keep the job you have, seek work if unemployed, rest if unwell, stay
out of trouble. Every fallback is recorded per job with its reason and is visible in the dashboard.

## Usage and ceilings

Provider-reported usage is recorded per request. When a provider omits usage the client records
conservative estimates (~4 bytes per token) and marks the period `estimate_only`.

Ceilings (`TIDEHAVEN_DAILY_TOKEN_CEILING`, `TIDEHAVEN_MONTHLY_TOKEN_CEILING`,
`TIDEHAVEN_DAILY_REQUEST_CEILING`) are checked **before** dispatch, with the estimated prompt plus the
maximum output reserved. Exceeding a hard ceiling raises a visible `quota` pause — the runner never
retries a paid request in a loop. Empty ceilings mean "no spending ceiling", not "no safety bounds":
concurrency, timeouts, retries, response size, population and storage remain capped.

Currency ceilings are deliberately not implemented: they require configured per-model prices, and
Tidehaven does not guess prices. Use token/request ceilings, or your provider's own spend limit.

## Probing

```bash
npm run doctor            # offline: config, SQLite, disk, build, data dir
npm run doctor -- --probe # one small, explicit paid request (≈20 tokens)
```

The probe reports the HTTP status, latency, whether `json_object` was accepted, and whether the model
returned parseable JSON. It never retries and never falls back to another model. Capability profiles are
cached in `provider_profiles` keyed by `(base URL, model)`.

## Cost planning

At 25 residents, a day costs roughly 25 requests (plus up to 4 dialogue replies). At the defaults
(3 000 input / 800 output token caps), a thousand days is on the order of 25 000 requests. The plan is
explicit that generation-scale runs (18 simulated years to raise a child to adulthood) are expensive;
the dashboard shows measured days/hour and fallback rate so you can decide, rather than trusting an
estimate.
