// Shared scrape config + the text -> Modifier[] engine used by the tlicompendium
// mappers (tlicompendium.ts). The rules recognise the common, cleanly-quoted
// combat stats found in effect text / affix templates; anything mechanic-
// specific (Terra Charge, Spell Burst, stacks, conversions, "Skill Area") is
// intentionally skipped — a documented approximation, since the calculator is a
// simplified model.
//
// (tlicompendium.com is the sole data source; the earlier tlidb.com HTML scrape
// was removed once the structured bundles covered every category.)

import type { DamageTag, Modifier, StatKey } from '@torchlight-companion/build-data';

export interface ScrapeConfig {
  /** Milliseconds between live requests (politeness). */
  delayMs: number;
  /** Directory for the on-disk bundle cache. */
  cacheDir: string;
  /** Cap the number of entities processed (for testing). 0 = no cap. */
  limit: number;
  /** Season version to pull, e.g. "SS12.5". Use resolveLatestVersion() to fill
   * this with the newest season the site publishes. */
  version: string;
  userAgent: string;
}

export const DEFAULT_CONFIG: ScrapeConfig = {
  delayMs: 400,
  cacheDir: '.bundle-cache',
  limit: 0,
  version: 'SS12.5',
  userAgent: 'torchlight-companion-scraper/0.1 (+github build planner)'
};

// -------------------------- text -> Modifier[] --------------------------------

const ELEMENT_WORDS = 'Physical|Fire|Cold|Lightning|Erosion';
const RESIST_STAT: Record<string, StatKey> = {
  Fire: 'fireResist',
  Cold: 'coldResist',
  Lightning: 'lightningResist',
  Erosion: 'erosionResist'
};
const INCREASED_ELEMENT: Record<string, StatKey> = {
  Physical: 'increasedPhysical',
  Fire: 'increasedFire',
  Cold: 'increasedCold',
  Lightning: 'increasedLightning',
  Erosion: 'increasedErosion'
};
const ADDED_ELEMENT: Record<string, StatKey> = {
  Physical: 'addedPhysical',
  Fire: 'addedFire',
  Cold: 'addedCold',
  Lightning: 'addedLightning',
  Erosion: 'addedErosion'
};

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Midpoint of a captured number and an optional second (range) number. */
function midpoint(a: string, b?: string): number {
  const x = Number(a);
  if (b === undefined) return x;
  return round((x + Number(b)) / 2, 3);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

interface Rule {
  re: RegExp;
  /** Returns every modifier this one match implies (usually one; the shared
   * Attack/Cast/Movement Speed list can imply two), or null for no match. */
  make(m: RegExpMatchArray): Modifier[] | null;
}

// A defensive "damage taken" qualifier right after the matched damage phrase
// (e.g. "additional Damage Over Time taken when having...") means the text is
// mitigation, not outgoing damage -- must not feed the moreDamage/increasedDamage
// rules below, confirmed against a real Vorax affix that was silently getting
// the sign backwards (a defensive stat read as a player damage penalty).
const NOT_DAMAGE_TAKEN = '(?!\\s*(?:over\\s+time\\s+)?taken\\b)';

// Ordered rules. Each is scanned globally over the text; every match emits
// zero or more modifiers.
const RULES: Rule[] = [
  {
    // "+32%~36% additional damage", "-6%~-3% additional damage", "+5% additional damage"
    // (but not "-50% additional Damage ... taken ..." -- see NOT_DAMAGE_TAKEN)
    re: new RegExp(
      `([+-]?\\d+(?:\\.\\d+)?)\\s*%?\\s*(?:~\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*%?)?\\s+additional\\s+damage${NOT_DAMAGE_TAKEN}`,
      'gi'
    ),
    make: (m) => (m[1] ? [{ stat: 'moreDamage', op: 'more', value: round(midpoint(m[1], m[2]) / 100, 4) }] : null)
  },
  {
    // "10.3% additional Cold Damage" — element-specific "additional" damage,
    // modelled as generic `more` (supports are slotted on element-matching skills).
    re: new RegExp(
      `([+-]?\\d+(?:\\.\\d+)?)\\s*%?\\s*(?:~\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*%?)?\\s+additional\\s+(?:${ELEMENT_WORDS})\\s+Damage${NOT_DAMAGE_TAKEN}`,
      'gi'
    ),
    make: (m) => (m[1] ? [{ stat: 'moreDamage', op: 'more', value: round(midpoint(m[1], m[2]) / 100, 4) }] : null)
  },
  {
    // "Adds 20-24 Cold Damage", "Adds 5-5 base Ignite Damage", and a trailing
    // "to Spells"/"to Attacks" qualifier tags the modifier accordingly instead
    // of silently dropping it and applying to every skill.
    re: new RegExp(
      `Adds\\s+(\\d+(?:\\.\\d+)?)\\s*-\\s*(\\d+(?:\\.\\d+)?)\\s+(?:base\\s+)?(${ELEMENT_WORDS})\\s+Damage(?:\\s+to\\s+(Spells|Attacks))?`,
      'gi'
    ),
    make: (m) => {
      const stat = m[3] ? ADDED_ELEMENT[capitalize(m[3])] : undefined;
      if (!stat || !m[1] || !m[2]) return null;
      const qualifier = m[4]?.toLowerCase();
      const tags: DamageTag[] | undefined =
        qualifier === 'spells' ? ['spell'] : qualifier === 'attacks' ? ['attack'] : undefined;
      return [{ stat, op: 'flat', value: midpoint(m[1], m[2]), ...(tags ? { tags } : {}) }];
    }
  },
  {
    re: new RegExp(`([+-]?\\d+(?:\\.\\d+)?)%\\s+(${ELEMENT_WORDS})\\s+Damage\\b`, 'gi'),
    make: (m) => {
      const stat = m[2] ? INCREASED_ELEMENT[capitalize(m[2])] : undefined;
      return stat && m[1] ? [{ stat, op: 'increased', value: Number(m[1]) }] : null;
    }
  },
  {
    // "+18% Attack Speed", "+18% Attack Speed, Cast Speed, and Movement Speed"
    // -- one shared value can apply to a list of speed types; movement speed
    // isn't modelled (no StatKey for it) so only attack/cast speed emit.
    re: /([+-]?\d+(?:\.\d+)?)%\s+((?:Attack|Cast|Movement)\s+Speed(?:\s*,\s*(?:Attack|Cast|Movement)\s+Speed)*(?:\s*,?\s*and\s+(?:Attack|Cast|Movement)\s+Speed)?)/gi,
    make: (m) => {
      if (!m[1] || !m[2]) return null;
      const value = Number(m[1]);
      const mods: Modifier[] = [];
      if (/Attack\s+Speed/i.test(m[2])) mods.push({ stat: 'increasedAttackSpeed', op: 'increased', value });
      if (/Cast\s+Speed/i.test(m[2])) mods.push({ stat: 'increasedCastSpeed', op: 'increased', value });
      return mods.length > 0 ? mods : null;
    }
  },
  {
    // "+25% Critical Strike Damage", but not "...Critical Strike Damage
    // Mitigation" (a defensive stat, not the player's own crit multiplier).
    re: /([+-]?\d+(?:\.\d+)?)%\s+Critical\s+Strike\s+Damage(?!\s+Mitigation\b)/gi,
    make: (m) => (m[1] ? [{ stat: 'critDamage', op: 'flat', value: Number(m[1]) }] : null)
  },
  {
    re: new RegExp(`([+-]?\\d+(?:\\.\\d+)?)%\\s+(${ELEMENT_WORDS})\\s+Resistance`, 'gi'),
    make: (m) => {
      const stat = m[2] ? RESIST_STAT[capitalize(m[2])] : undefined;
      return stat && m[1] ? [{ stat, op: 'flat', value: Number(m[1]) }] : null;
    }
  },
  {
    // "+15% maximum Life", "+10% Max Life and maximum Energy Shield"
    re: /([+-]?\d+(?:\.\d+)?)%\s+(?:increased\s+)?(?:maximum|Max)\s+Life/gi,
    make: (m) => (m[1] ? [{ stat: 'increasedLife', op: 'increased', value: Number(m[1]) }] : null)
  },
  {
    // "+330 Max Life", "+168 maximum Life"
    re: /\+(\d+(?:\.\d+)?)\s+(?:maximum|Max)\s+Life\b/gi,
    make: (m) => (m[1] ? [{ stat: 'life', op: 'flat', value: Number(m[1]) }] : null)
  },
  {
    // generic "+90% damage" (lowercase, unqualified) -> increased. Avoids
    // "Minion Damage"/"Weapon Attack Damage" (capitalised), "additional
    // damage" (matched above, which consumes the word "additional"), and a
    // directly-following "Minion Damage" qualifier (confirmed real text like
    // "183% damage Minion Damage" -- minion-only damage, not player damage).
    re: /([+-]?\d+(?:\.\d+)?)%\s+damage\b(?!\s*Minion\s+Damage)/g,
    make: (m) => (m[1] ? [{ stat: 'increasedDamage', op: 'increased', value: Number(m[1]) }] : null)
  },
  {
    // "+720 gear Armor", "+300 Armor"
    re: /\+(\d+(?:\.\d+)?)\s+(?:gear\s+)?Armor\b/gi,
    make: (m) => (m[1] ? [{ stat: 'armor', op: 'flat', value: Number(m[1]) }] : null)
  }
];

/**
 * Best-effort extraction of build-data modifiers from effect text / affix
 * templates. Only the common, cleanly-quoted combat stats are recognised;
 * anything mechanic-specific is skipped. Deduplicates identical (stat/op/value)
 * matches (source text often repeats a line across summary + detail blocks).
 */
export function parseModifiers(text: string): Modifier[] {
  const byKey = new Map<string, Modifier>();
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.re)) {
      const mods = rule.make(m);
      if (!mods) continue;
      for (const mod of mods) {
        if (!Number.isFinite(mod.value) || mod.value === 0) continue;
        byKey.set(`${mod.stat}|${mod.op}|${mod.value}`, mod);
      }
    }
  }
  return [...byKey.values()];
}
