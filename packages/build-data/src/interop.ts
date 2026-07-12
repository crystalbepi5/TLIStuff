// Build serialisation + import/export interop.
//
// Two goals for the "stop competing, interoperate" direction:
//   1. A solid, tested NATIVE share-code format for our own builds.
//   2. A pluggable adapter framework so builds from external planners
//      (TLI Compendium, Torchlight of Building) can be imported.
//
// The external adapters are honest stubs: their real share-code formats aren't
// public and the sites are unreachable from the build sandbox, so `parse`
// throws a clear "need a sample" error until the format is filled in. The
// framework — detection, URL handling, native round-trip — is real and tested.

import type { Build } from './schema.js';

/** Bumped when the native envelope shape changes. */
export const SHARE_VERSION = 1;

interface ShareEnvelope {
  v: number;
  build: Build;
}

/** Fill in any Build fields an older/partial payload may be missing. */
export function normalizeBuild(partial: Partial<Build>): Build {
  return {
    id: partial.id ?? 'imported',
    name: partial.name ?? 'Imported Build',
    heroId: partial.heroId ?? '',
    activeSkillId: partial.activeSkillId ?? '',
    supportIds: partial.supportIds ?? [],
    gear: partial.gear ?? [],
    talentIds: partial.talentIds ?? [],
    pactSpiritIds: partial.pactSpiritIds ?? [],
    divinityIds: partial.divinityIds ?? [],
    extraModifiers: partial.extraModifiers ?? []
  };
}

function toBase64(text: string): string {
  // Works in both browser and Node without extra deps.
  if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(text)));
  return Buffer.from(text, 'utf-8').toString('base64');
}

function fromBase64(b64: string): string {
  if (typeof atob === 'function') return decodeURIComponent(escape(atob(b64)));
  return Buffer.from(b64, 'base64').toString('utf-8');
}

/** Encode a build as our native share code. */
export function encodeShareCode(build: Build): string {
  const envelope: ShareEnvelope = { v: SHARE_VERSION, build };
  return toBase64(JSON.stringify(envelope));
}

/**
 * Decode our native share code. Accepts both the current envelope form and a
 * bare Build object (forward-compatible with earlier codes), and backfills
 * missing fields. Throws if the input isn't valid native JSON.
 */
export function decodeShareCode(code: string): Build {
  const parsed = JSON.parse(fromBase64(code.trim())) as unknown;
  if (parsed && typeof parsed === 'object' && 'build' in (parsed as ShareEnvelope)) {
    return normalizeBuild((parsed as ShareEnvelope).build);
  }
  return normalizeBuild(parsed as Partial<Build>);
}

export type ImportResult =
  | { ok: true; build: Build; format: string; warnings: string[] }
  | { ok: false; error: string };

/** An importer for one external planner's share format. */
export interface ExternalAdapter {
  id: string;
  label: string;
  /** Cheap check: does this input look like it belongs to this planner? */
  detect(input: string): boolean;
  /** Parse a detected input. May throw with a human-readable message. */
  parse(input: string): { build: Build; warnings: string[] };
}

/** Pull an embedded code out of a share URL, or return the input unchanged. */
export function extractCode(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    // Most PoB-style tools stash the build in the hash or a query param.
    const hash = url.hash.replace(/^#/, '');
    if (hash) return decodeURIComponent(hash.split('=').pop() ?? hash);
    const param = url.searchParams.get('build') ?? url.searchParams.get('code');
    if (param) return param;
    // Fall back to the last non-empty path segment (e.g. /build/<code>).
    const seg = url.pathname.split('/').filter(Boolean).pop();
    return seg ?? trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Does this input actually carry a build, or is it just an editor URL?
 *
 * Planners like TLI Compendium keep the live editor at a static path
 * (`/en/build-planner`) and only embed a build when you explicitly Export/Share
 * — as a `#hash`, a `?build=`/`?code=` param, or a `/build/<id>` segment. A bare
 * code string (not a URL) is assumed to be a payload.
 */
export function hasEmbeddedPayload(input: string): boolean {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed.length > 0;
  try {
    const url = new URL(trimmed);
    if (url.hash.replace(/^#/, '').length > 0) return true;
    if (url.searchParams.get('build') ?? url.searchParams.get('code')) return true;
    // A share path like /build/<id> or /b/<id> carries an id after the keyword.
    const segments = url.pathname.split('/').filter(Boolean);
    const keyIdx = segments.findIndex((s) => s === 'build' || s === 'b');
    return keyIdx >= 0 && keyIdx < segments.length - 1;
  } catch {
    return false;
  }
}

function notYetSupported(label: string): never {
  throw new Error(
    `${label} import isn't wired up yet — its share-code format isn't public. ` +
      `Paste a sample ${label} code/URL to have the adapter completed.`
  );
}

export const compendiumAdapter: ExternalAdapter = {
  id: 'compendium',
  label: 'TLI Compendium',
  detect: (input) => /tlicompendium\.com/i.test(input),
  parse: () => notYetSupported('TLI Compendium')
};

export const pobAdapter: ExternalAdapter = {
  id: 'pob',
  label: 'Torchlight of Building',
  detect: (input) => /tlipob\.com/i.test(input),
  parse: () => notYetSupported('Torchlight of Building')
};

export const externalAdapters: ExternalAdapter[] = [compendiumAdapter, pobAdapter];

/**
 * Import a build from any supported source: our native code, or (once wired) an
 * external planner's code/URL. Tries native first, then any adapter that
 * claims the input. Never throws — returns a discriminated result.
 */
export function importBuildCode(
  input: string,
  adapters: ExternalAdapter[] = externalAdapters
): ImportResult {
  const code = extractCode(input);

  // External adapters get first refusal when the input clearly names their host,
  // so a Compendium URL doesn't get misread as malformed native input.
  const claimed = adapters.find((a) => a.detect(input));
  if (claimed) {
    // The live editor URL contains no build — tell the user how to get one.
    if (!hasEmbeddedPayload(input)) {
      return {
        ok: false,
        error:
          `That's the ${claimed.label} editor URL — it doesn't contain a build. ` +
          `Use ${claimed.label}'s Export / Share to copy a build code or share link, then paste that here.`
      };
    }
    try {
      const { build, warnings } = claimed.parse(input);
      return { ok: true, build, format: claimed.id, warnings };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    return { ok: true, build: decodeShareCode(code), format: 'native', warnings: [] };
  } catch {
    return {
      ok: false,
      error: 'Unrecognised build code. Expected a native share code or a supported planner URL.'
    };
  }
}
