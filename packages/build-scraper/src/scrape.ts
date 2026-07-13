// Shared scrape config + the text -> Modifier[] engine used by the tlicompendium
// mappers (tlicompendium.ts). The rules recognise the common, cleanly-quoted
// combat stats found in effect text / affix templates; anything mechanic-
// specific (Terra Charge, Spell Burst, stacks, conversions, "Skill Area") is
// intentionally skipped — a documented approximation, since the calculator is a
// simplified model.
//
// (tlicompendium.com is the sole data source; the earlier tlidb.com HTML scrape
// was removed once the structured bundles covered every category.)

import type { Modifier, StatKey } from '@torchlight-companion/build-data';

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
  make(m: RegExpMatchArray): Modifier | null;
}

// Ordered rules. Each is scanned globally over the text; every match emits a
// modifier.
const RULES: Rule[] = [
  {
    // "+32%~36% additional damage", "-6%~-3% additional damage", "+5% additional damage"
    re: /([+-]?\d+(?:\.\d+)?)\s*%?\s*(?:~\s*([+-]?\d+(?:\.\d+)?)\s*%?)?\s+additional\s+damage/gi,
    make: (m) => (m[1] ? { stat: 'moreDamage', op: 'more', value: round(midpoint(m[1], m[2]) / 100, 4) } : null)
  },
  {
    // "10.3% additional Cold Damage" — element-specific "additional" damage,
    // modelled as generic `more` (supports are slotted on element-matching skills).
    re: new RegExp(
      `([+-]?\\d+(?:\\.\\d+)?)\\s*%?\\s*(?:~\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*%?)?\\s+additional\\s+(?:${ELEMENT_WORDS})\\s+Damage`,
      'gi'
    ),
    make: (m) => (m[1] ? { stat: 'moreDamage', op: 'more', value: round(midpoint(m[1], m[2]) / 100, 4) } : null)
  },
  {
    // "Adds 20-24 Cold Damage", "Adds 5-5 base Ignite Damage"
    re: new RegExp(`Adds\\s+(\\d+(?:\\.\\d+)?)\\s*-\\s*(\\d+(?:\\.\\d+)?)\\s+(?:base\\s+)?(${ELEMENT_WORDS})\\s+Damage`, 'gi'),
    make: (m) => {
      const stat = m[3] ? ADDED_ELEMENT[capitalize(m[3])] : undefined;
      return stat && m[1] && m[2] ? { stat, op: 'flat', value: midpoint(m[1], m[2]) } : null;
    }
  },
  {
    re: new RegExp(`([+-]?\\d+(?:\\.\\d+)?)%\\s+(${ELEMENT_WORDS})\\s+Damage\\b`, 'gi'),
    make: (m) => {
      const stat = m[2] ? INCREASED_ELEMENT[capitalize(m[2])] : undefined;
      return stat && m[1] ? { stat, op: 'increased', value: Number(m[1]) } : null;
    }
  },
  {
    re: /([+-]?\d+(?:\.\d+)?)%\s+(Attack|Cast)\s+Speed/gi,
    make: (m) =>
      m[1] && m[2]
        ? { stat: m[2].toLowerCase() === 'attack' ? 'increasedAttackSpeed' : 'increasedCastSpeed', op: 'increased', value: Number(m[1]) }
        : null
  },
  {
    re: /([+-]?\d+(?:\.\d+)?)%\s+Critical\s+Strike\s+Damage/gi,
    make: (m) => (m[1] ? { stat: 'critDamage', op: 'flat', value: Number(m[1]) } : null)
  },
  {
    re: new RegExp(`([+-]?\\d+(?:\\.\\d+)?)%\\s+(${ELEMENT_WORDS})\\s+Resistance`, 'gi'),
    make: (m) => {
      const stat = m[2] ? RESIST_STAT[capitalize(m[2])] : undefined;
      return stat && m[1] ? { stat, op: 'flat', value: Number(m[1]) } : null;
    }
  },
  {
    // "+15% maximum Life", "+10% Max Life and maximum Energy Shield"
    re: /([+-]?\d+(?:\.\d+)?)%\s+(?:increased\s+)?(?:maximum|Max)\s+Life/gi,
    make: (m) => (m[1] ? { stat: 'increasedLife', op: 'increased', value: Number(m[1]) } : null)
  },
  {
    // "+330 Max Life", "+168 maximum Life"
    re: /\+(\d+(?:\.\d+)?)\s+(?:maximum|Max)\s+Life\b/gi,
    make: (m) => (m[1] ? { stat: 'life', op: 'flat', value: Number(m[1]) } : null)
  },
  {
    // generic "+90% damage" (lowercase, unqualified) -> increased. Avoids
    // "Minion Damage"/"Weapon Attack Damage" (capitalised) and "additional
    // damage" (matched above, which consumes the word "additional").
    re: /([+-]?\d+(?:\.\d+)?)%\s+damage\b/g,
    make: (m) => (m[1] ? { stat: 'increasedDamage', op: 'increased', value: Number(m[1]) } : null)
  },
  {
    // "+720 gear Armor", "+300 Armor"
    re: /\+(\d+(?:\.\d+)?)\s+(?:gear\s+)?Armor\b/gi,
    make: (m) => (m[1] ? { stat: 'armor', op: 'flat', value: Number(m[1]) } : null)
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
      const mod = rule.make(m);
      if (!mod || !Number.isFinite(mod.value) || mod.value === 0) continue;
      byKey.set(`${mod.stat}|${mod.op}|${mod.value}`, mod);
    }
  }
  return [...byKey.values()];
}
