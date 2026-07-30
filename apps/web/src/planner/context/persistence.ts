import type { Build } from '@torchlight-companion/build-data';

export const STORAGE_KEY = 'tli-planner:build';
export const SCHEMA_VERSION = 1;

export interface PlannerEnvelope {
  schemaVersion: number;
  updatedAt: number;
  build: Build;
  activeSection?: string;
}

export function encodeEnvelope(build: Build, activeSection: string): string {
  const envelope: PlannerEnvelope = { schemaVersion: SCHEMA_VERSION, updatedAt: Date.now(), build, activeSection };
  return JSON.stringify(envelope);
}

/** Best-effort recovery: any structurally-invalid or future-schema payload
 * is treated as absent rather than thrown, so a corrupted localStorage
 * value can never block the app from loading. */
export function decodeEnvelope(raw: string): PlannerEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const candidate = parsed as Partial<PlannerEnvelope>;
  if (typeof candidate.schemaVersion !== 'number' || candidate.schemaVersion > SCHEMA_VERSION) {
    return undefined; // unknown future schema -- don't guess at migration
  }
  if (!candidate.build || typeof candidate.build !== 'object') return undefined;
  return migrateEnvelope(candidate as PlannerEnvelope);
}

/** No migrations needed yet (schema is at v1 from the start of this
 * rebuild) -- this is the seam future schema bumps hang their upgrade
 * steps off of, run in order from whatever version was stored. */
function migrateEnvelope(envelope: PlannerEnvelope): PlannerEnvelope {
  return envelope;
}

/** Reads the persisted envelope from localStorage, if any. Swallows
 * storage-access errors (private browsing, disabled storage, quota) so a
 * blocked/unavailable localStorage never prevents the app from loading --
 * it just starts from a fresh build instead of a recovered one. */
export function loadStoredEnvelope(): PlannerEnvelope | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return decodeEnvelope(raw);
  } catch {
    return undefined;
  }
}

/** Writes the envelope to localStorage. Returns whether the write
 * succeeded, so callers can reflect a failed save (e.g. quota exceeded)
 * in the UI instead of silently claiming "saved". */
export function saveEnvelope(build: Build, activeSection: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, encodeEnvelope(build, activeSection));
    return true;
  } catch {
    return false;
  }
}
