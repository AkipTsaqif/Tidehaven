import type { Db } from '../storage/database.js';
import type { Capability } from './client.js';

/**
 * Provider capability handling.
 *
 * JSON Schema support is not universal across OpenAI-compatible gateways, so the mode is discovered
 * once (probe or first failure), cached per (baseUrl, model), and degrade-only: a 400 mentioning
 * response_format moves the profile down to plain JSON, never up to a different model.
 */

export interface ProviderProfile {
  key: string;
  baseUrl: string;
  model: string;
  capability: Capability;
  probedAt: string;
  detail: string | null;
}

/**
 * One canonical key for a provider profile.
 *
 * The probe is given the configured API root (`.../v1`) while the runtime client looks up its own
 * resolved endpoint (`.../v1/chat/completions`). Both must map to the same profile, so the key strips
 * the endpoint suffix and trailing slashes before normalising.
 */
export function profileKey(baseUrl: string, model: string): string {
  const normalised = baseUrl
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return `${normalised}#${model}`;
}

export function readCapability(db: Db, baseUrl: string, model: string): Capability | null {
  const row = db.get<{ capability: string }>('select capability from provider_profiles where profile_key = ?', [
    profileKey(baseUrl, model),
  ]);
  if (!row) return null;
  if (row.capability === 'json_schema' || row.capability === 'json_object' || row.capability === 'plain_json') {
    return row.capability;
  }
  return null;
}

export function writeCapability(
  db: Db,
  params: { baseUrl: string; model: string; capability: Capability; detail?: string },
): void {
  const key = profileKey(params.baseUrl, params.model);
  db.run(
    `insert into provider_profiles (profile_key, base_url, model, capability, probed_at, detail)
     values (?, ?, ?, ?, ?, ?)
     on conflict(profile_key) do update set capability = excluded.capability, probed_at = excluded.probed_at,
       detail = excluded.detail`,
    [key, params.baseUrl, params.model, params.capability, new Date().toISOString(), params.detail ?? null],
  );
}

/** Downgrade ladder: schema -> json_object -> plain_json. Never climbs back automatically. */
export function downgrade(capability: Capability): Capability | null {
  if (capability === 'json_schema') return 'json_object';
  if (capability === 'json_object') return 'plain_json';
  return null;
}

export function capabilityFromEnv(raw: string | undefined): Capability | null {
  if (raw === 'json_schema' || raw === 'json_object' || raw === 'plain_json') return raw;
  return null;
}
