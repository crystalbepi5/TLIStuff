import type { ActiveSkill, SupportSkill } from '@torchlight-companion/build-data';

/**
 * The real total mana cost of a skill setup: the active skill's own
 * manaCost, scaled by each socketed support's manaMultiplier in turn (e.g.
 * a 130 multiplier means "×1.30", stacking multiplicatively support by
 * support -- the same convention documented on SupportSkill.manaMultiplier).
 *
 * Deliberately NOT compared against any fixed "budget"/cap: no Max Mana or
 * energy-pool stat exists anywhere in the scraped data (checked heroes and
 * every skill bundle), so a hard cap here would be a fabricated number, not
 * a modeled game mechanic. This is an honest, real total for comparing
 * setups against each other -- not an enforced constraint.
 */
export function totalManaCost(skill: ActiveSkill, supports: (SupportSkill | undefined)[]): number {
  const base = skill.manaCost ?? 0;
  const multiplier = supports.reduce((acc, s) => acc * ((s?.manaMultiplier ?? 100) / 100), 1);
  return base * multiplier;
}
