import {
  seedDataset,
  indexDataset,
  type Build,
  type GearSlot,
  type VoraxAffix,
  type VoraxLegendary
} from '@torchlight-companion/build-data';

export const index = indexDataset(seedDataset);

/** ActiveSkill/SupportSkill `icon` fields are relative paths into
 * tlicompendium.com's image host (see schema.ts) -- this is real scraped
 * game art, not a fabricated asset, so it's used as-is rather than
 * generating a placeholder for skills. Heroes have no equivalent `icon`
 * field in the schema at all (confirmed: `Hero` only carries id/name/
 * description/baseModifiers/season), so hero cards fall back to a
 * generated monogram instead -- see HeroAvatar. */
const ICON_HOST = 'https://tlicompendium.com';

/** Resolves any of ActiveSkill/SupportSkill/GearBase's relative `icon` paths
 * to a full URL. GearBase.icon is only present for bases scraped via
 * gear-master (see its schema.ts doc comment) -- legendaries have none. */
export function resolveIconUrl(icon: string | undefined): string | undefined {
  return icon ? `${ICON_HOST}${icon}` : undefined;
}

export const skillIconUrl = resolveIconUrl;

export const GEAR_SLOTS: GearSlot[] = [
  'weapon',
  'offhand',
  'helmet',
  'chest',
  'gloves',
  'boots',
  'belt',
  'amulet',
  'ring'
];

/** Cap how many unselected matches a filtered list renders, to keep the DOM
 * light when the dataset has hundreds of entries. */
export const LIST_LIMIT = 60;

export function defaultBuild(): Build {
  return {
    id: 'draft',
    name: 'New Build',
    heroId: seedDataset.heroes[0]?.id ?? '',
    activeSkillId: seedDataset.activeSkills[0]?.id ?? '',
    supportIds: [],
    gear: [],
    voraxGear: [],
    talentIds: [],
    talentTreeNodeIds: [],
    voidChartNodeIds: [],
    pactSpiritIds: [],
    memoryIds: [],
    extraModifiers: []
  };
}

/**
 * Filter a named list by a search string: selected items always show (so you
 * can unselect them), plus matching unselected items up to LIST_LIMIT.
 */
export function filterList<T extends { id: string; name: string }>(
  items: T[],
  selectedIds: string[],
  search: string
): { shown: T[]; hidden: number } {
  const q = search.trim().toLowerCase();
  const selected = items.filter((i) => selectedIds.includes(i.id));
  const matching = items.filter(
    (i) => !selectedIds.includes(i.id) && (q === '' || i.name.toLowerCase().includes(q))
  );
  return {
    shown: [...selected, ...matching.slice(0, LIST_LIMIT)],
    hidden: Math.max(0, matching.length - LIST_LIMIT)
  };
}

export function encodeBuild(build: Build): string {
  return btoa(encodeURIComponent(JSON.stringify(build)));
}

/** Pulls the `build` param out if given a full share URL instead of a bare
 * code (e.g. pasted from the clipboard-unavailable fallback), otherwise
 * returns the input unchanged. */
function extractCode(input: string): string {
  const trimmed = input.trim();
  try {
    const asUrl = new URL(trimmed);
    return asUrl.searchParams.get('build') ?? trimmed;
  } catch {
    return trimmed; // not a URL — treat as a bare code
  }
}

/** Decode a share code (or a full share URL), backfilling any fields older
 * codes may lack. */
export function decodeBuild(code: string): Build {
  const parsed = JSON.parse(decodeURIComponent(atob(extractCode(code)))) as Partial<Build>;
  return {
    ...defaultBuild(),
    ...parsed,
    gear: parsed.gear ?? [],
    voraxGear: parsed.voraxGear ?? [],
    supportIds: parsed.supportIds ?? [],
    talentIds: parsed.talentIds ?? [],
    talentTreeNodeIds: parsed.talentTreeNodeIds ?? [],
    voidChartNodeIds: parsed.voidChartNodeIds ?? [],
    pactSpiritIds: parsed.pactSpiritIds ?? [],
    memoryIds: parsed.memoryIds ?? [],
    extraModifiers: parsed.extraModifiers ?? []
  };
}

/** A shareable link puts the code in the query string (`?build=...#planner`)
 * rather than only the copy-paste textarea, so a streamer can drop one
 * clickable link in chat/panel and a viewer lands straight on that build. */
export function shareUrl(build: Build): string {
  const url = new URL(window.location.href);
  url.hash = 'planner';
  url.searchParams.set('build', encodeBuild(build));
  return url.toString();
}

/** Reads `?build=` from the current URL, if present — used once on load so a
 * shared link opens directly onto that build instead of the blank default. */
export function buildFromUrl(): Build | undefined {
  const code = new URLSearchParams(window.location.search).get('build');
  if (!code) return undefined;
  try {
    return decodeBuild(code);
  } catch {
    return undefined;
  }
}

/** Vorax affixes/legendaries have no `name` field in the scraped data (the
 * game never labels them individually the way regular affixes are) -- these
 * synthesize a readable option label from the modifiers themselves, the same
 * "describe from modifiers" pattern the crafting sim page uses. */
/** `more` values are stored as a decimal multiplier (0.08 -> x1.08, i.e. 8%
 * more -- see aggregate()'s `more *= 1 + mod.value`), while `increased`
 * values are already plain percentage numbers. Scale `more` by 100 before
 * display or it reads as "+0.08%" instead of "+8%". */
export function describeVoraxModifiers(modifiers: { stat: string; op: string; value: number }[]): string {
  if (modifiers.length === 0) return '(no modeled effect yet)';
  return modifiers
    .map((m) => {
      const value = m.op === 'more' ? m.value * 100 : m.value;
      return `${value >= 0 ? '+' : ''}${value}${m.op === 'flat' ? '' : '%'} ${m.stat}`;
    })
    .join(', ');
}

/** Generic alias: describeVoraxModifiers doesn't actually reference
 * anything Vorax-specific (it's structurally typed on {stat, op, value}),
 * so it's reused as-is for regular gear-affix modifiers too rather than
 * duplicating the same "more is a x100 decimal multiplier" scaling logic
 * a third time in this codebase. */
export const describeModifiers = describeVoraxModifiers;

export function voraxAffixLabel(a: VoraxAffix): string {
  return describeVoraxModifiers(a.modifiers);
}

export function voraxLegendaryLabel(l: VoraxLegendary): string {
  return describeVoraxModifiers(l.modifiers);
}
