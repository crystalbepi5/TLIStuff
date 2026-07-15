#!/usr/bin/env python3
"""
Crafting simulator for Torchlight: Infinite, built on top of the tlidb.com
scrape (see ../scraper/scrape_tlidb.py).

What this does and doesn't cover
---------------------------------
tlidb.com exposes several distinct crafting subsystems. Only some of them
publish a numeric RNG "Weight" column -- that's the only place real
probabilities can come from, so that's the only thing this simulates:

  SIMULATABLE (weighted-random affix pools, "Tier"/"Modifier"/"Level"/"Weight"):
    - regular gear crafting: the "Craft" / "Base Affix" / "Legendary" tables
      nested inside each item base's detail page (e.g. /en/Vorax_Limb:_Hands)
    - Memory Revival: the three global pools in listings/Memory_Revival.json

  DETERMINISTIC (no RNG -- a lookup, not a simulation):
    - Enchant: listings/Enchant.json is a fixed ladder per enchant type --
      each "Quality" step has an exact currency cost, level gate, and
      effect range. --enchant-type looks this up directly.
    - Blending Rituals / Recipe: fixed ingredient -> effect recipes.

  NOT MODELABLE (mechanic is known, but no weight data is published):
    - Corrosion: "Corrosion Base Affix" has Tier/Modifier/Type but no Weight,
      so which mod gets picked can't be modeled -- only "what are the
      possible mods" can be listed.
    - Graft / Gear Empowerment: descriptive-only pages, no numeric data.

Important caveat about "Weight": on the per-item gear Craft/Base Affix
tables, every enabled row has the *same* Weight value -- it's really an
available/unavailable flag, not a differentiated RNG weight. Odds computed
from those pools assume uniform chance among enabled+matching rows, which
is NOT a confirmed in-game probability. Memory Revival's "Special Random
Affix" pool is the one place that publishes genuinely different weights
per row, so its odds are on firmer ground. The tool prints a warning
whenever it detects a flat (all-equal-weight) pool.

Every modifier's "(min-max)" roll range is parsed out too, so once an affix
is chosen you can also sample a plausible rolled value (uniform within the
published range -- the site doesn't expose the game's actual roll
distribution, so uniform is the standard assumption used by community
calculators for this genre).

Usage:
    # List item detail pages that have a weighted craft pool
    python crafting_sim.py --list-items

    # Inspect a pool
    python crafting_sim.py --item "Vorax_Limb:_Hands" --show-pool

    # Monte Carlo: how many crafts to hit a T0 mod, on this item base
    python crafting_sim.py --item "Vorax_Limb:_Hands" --target-tier 0 --trials 200000

    # Same, but filtering to mods whose text matches a substring
    python crafting_sim.py --item "Vorax_Limb:_Hands" --target-text "Max Life" --trials 200000

    # Memory Revival pools are global (not per-item), pass the listing pane directly
    python crafting_sim.py --global-pool "Special Random Affix" --target-tier 0

    # Enchant is deterministic -- look up the full quality ladder + costs
    python crafting_sim.py --enchant-type "Added % of Cold Damage as Erosion Damage"
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote

DEFAULT_DATA_DIR = Path(__file__).parent.parent / "scraper_output" / "tlidb_output"

RANGE_RE = re.compile(r"\((-?\d+(?:\.\d+)?)[–\-](-?\d+(?:\.\d+)?)\)\s*(%)?")


@dataclass
class AffixRow:
    tier: str | None
    text: str
    level: int | None
    weight: float
    ranges: list[tuple[float, float, bool]] = field(default_factory=list)  # (lo, hi, is_pct)
    raw: dict = field(default_factory=dict)

    def sample_value(self, rng: random.Random) -> list[float]:
        return [round(rng.uniform(lo, hi), 2) for lo, hi, _ in self.ranges]


def parse_ranges(text: str) -> list[tuple[float, float, bool]]:
    out = []
    for m in RANGE_RE.finditer(text):
        lo, hi, pct = float(m.group(1)), float(m.group(2)), bool(m.group(3))
        out.append((lo, hi, pct))
    return out


def parse_level(value) -> int | None:
    if value is None:
        return None
    m = re.search(r"-?\d+", str(value))
    return int(m.group()) if m else None


def rows_from_table(entries: list[dict]) -> list[AffixRow] | None:
    """Convert a parsed table's row dicts into AffixRows, if it has a Weight column."""
    if not entries or "Weight" not in entries[0]:
        return None
    rows = []
    for e in entries:
        text = e.get("Modifier") or e.get("Affix Effect") or ""
        try:
            weight = float(e.get("Weight", 0) or 0)
        except ValueError:
            weight = 0.0
        rows.append(
            AffixRow(
                tier=e.get("Tier"),
                text=text,
                level=parse_level(e.get("Level") if "Level" in e else e.get("Lv")),
                weight=weight,
                ranges=parse_ranges(text),
                raw=e,
            )
        )
    return [r for r in rows if r.weight > 0]


def pool_is_flat(pool: list[AffixRow]) -> bool:
    """True if every row shares the same weight -- i.e. this table's 'Weight'
    column is really just an available/unavailable flag (as seen on the
    per-item gear Craft/Base Affix tables), not a differentiated RNG weight
    like Memory Revival's Special Random Affix pool. Odds computed from a
    flat pool are a "uniform among currently enabled mods" assumption, not
    a confirmed in-game probability."""
    weights = {r.weight for r in pool}
    return len(weights) <= 1


def load_item_pools(data_dir: Path, item_slug: str) -> dict[str, list[AffixRow]]:
    """Load every weighted table nested in an item's detail page, keyed by pane title."""
    item_slug = unquote(item_slug)
    path = data_dir / "details" / f"{item_slug}.json"
    if not path.exists():
        raise FileNotFoundError(f"no detail page cached for {item_slug!r} at {path}")
    detail = json.loads(path.read_text(encoding="utf-8"))
    pools = {}
    for pane in detail.get("nested_listings") or []:
        if pane["kind"] != "table":
            continue
        rows = rows_from_table(pane["entries"])
        if rows:
            pools[pane["title"]] = rows
    return pools


def load_global_pool(data_dir: Path, category: str, pane_title: str) -> list[AffixRow]:
    path = data_dir / "listings" / f"{category}.json"
    panes = json.loads(path.read_text(encoding="utf-8"))
    for pane in panes:
        if pane_title.lower() in (pane["title"] or "").lower():
            rows = rows_from_table(pane["entries"])
            if rows:
                return rows
    raise ValueError(f"no weighted pool named like {pane_title!r} found in {category}")


def enchant_ladder(data_dir: Path, type_substr: str) -> list[dict]:
    """Enchant is a deterministic quality ladder, not RNG -- just look it up."""
    path = data_dir / "listings" / "Enchant.json"
    panes = json.loads(path.read_text(encoding="utf-8"))
    needle = type_substr.lower()
    rows = []
    for pane in panes:
        if pane["kind"] != "table":
            continue
        for e in pane["entries"]:
            if needle in (e.get("Type") or "").lower():
                rows.append(e)
    rows.sort(key=lambda e: parse_level(e.get("Quality")) or 0)
    return rows


def list_craftable_items(data_dir: Path) -> list[tuple[str, list[str]]]:
    """Scan every cached detail page and report which ones have a weighted pool."""
    out = []
    for path in sorted((data_dir / "details").glob("*.json")):
        try:
            detail = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        pool_names = []
        for pane in detail.get("nested_listings") or []:
            if pane["kind"] == "table" and pane["entries"] and "Weight" in pane["entries"][0]:
                pool_names.append(pane["title"])
        if pool_names:
            out.append((path.stem, pool_names))
    return out


def filter_pool(pool: list[AffixRow], target_tier: str | None, target_text: str | None,
                 max_level: int | None) -> list[AffixRow]:
    matches = pool
    if target_tier is not None:
        matches = [r for r in matches if r.tier == target_tier]
    if target_text:
        needle = target_text.lower()
        matches = [r for r in matches if needle in r.text.lower()]
    if max_level is not None:
        matches = [r for r in matches if r.level is None or r.level <= max_level]
    return matches


def analytic_odds(pool: list[AffixRow], matches: list[AffixRow]) -> dict:
    total_weight = sum(r.weight for r in pool)
    match_weight = sum(r.weight for r in matches)
    p = match_weight / total_weight if total_weight else 0.0
    return {
        "pool_size": len(pool),
        "total_weight": total_weight,
        "matching_rows": len(matches),
        "matching_weight": match_weight,
        "chance_per_craft": p,
        "expected_attempts": (1 / p) if p > 0 else float("inf"),
    }


def monte_carlo(pool: list[AffixRow], matches: list[AffixRow], trials: int, seed: int | None) -> dict:
    rng = random.Random(seed)
    weights = [r.weight for r in pool]
    match_set = set(id(r) for r in matches)
    attempts_needed = []
    hits = 0
    for _ in range(trials):
        attempts = 0
        while True:
            attempts += 1
            picked = rng.choices(pool, weights=weights, k=1)[0]
            if id(picked) in match_set:
                hits += 1
                attempts_needed.append(attempts)
                break
            if attempts > 100_000:  # safety valve against pathological zero-probability targets
                break
    n = len(attempts_needed)
    avg = sum(attempts_needed) / n if n else float("inf")
    return {
        "trials": trials,
        "simulated_hit_rate": hits / trials if trials else 0.0,
        "simulated_avg_attempts": avg,
    }


def main() -> None:
    try:
        run()
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)


def run() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--item", help="Item detail-page slug, e.g. Vorax_Limb:_Hands")
    parser.add_argument("--pool", help="Which of the item's tables to use (default: first with a Weight column)")
    parser.add_argument("--global-pool", help="Pane title within a category listing, e.g. 'Special Random Affix'")
    parser.add_argument("--global-category", default="Memory_Revival")
    parser.add_argument("--list-items", action="store_true", help="List every item that has a weighted craft pool")
    parser.add_argument("--enchant-type", help="Look up the deterministic Enchant quality ladder for a type (substring match)")
    parser.add_argument("--show-pool", action="store_true", help="Print the full pool and exit")
    parser.add_argument("--target-tier")
    parser.add_argument("--target-text")
    parser.add_argument("--max-level", type=int)
    parser.add_argument("--trials", type=int, default=0, help="Monte Carlo trial count (0 = analytic only)")
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    if args.list_items:
        # Tab-separated on purpose: slugs like "Vorax_Limb:_Hands" contain a
        # colon themselves, so "slug: pools" would be ambiguous to parse.
        for slug, pool_names in list_craftable_items(args.data_dir):
            print(f"{slug}\t{', '.join(pool_names)}")
        return

    if args.enchant_type:
        rows = enchant_ladder(args.data_dir, args.enchant_type)
        if not rows:
            print(f"No Enchant type matching {args.enchant_type!r}.")
            return
        print(f"=== Enchant ladder: {rows[0].get('Type')} ({rows[0].get('affix_type')}) ===")
        for r in rows:
            print(f"  Quality {r.get('Quality','?'):<3} unlock={r.get('UnlockCondition',''):<8} "
                  f"cost={r.get('EnchantmentExpend',''):<20} -> {r.get('Effect','')}")
        return

    if args.global_pool:
        pool = load_global_pool(args.data_dir, args.global_category, args.global_pool)
        pool_label = f"{args.global_category} / {args.global_pool}"
    elif args.item:
        pools = load_item_pools(args.data_dir, args.item)
        if not pools:
            print(f"No weighted craft pool found for {args.item!r}.")
            return
        pool_name = args.pool or next(iter(pools))
        if pool_name not in pools:
            print(f"No pool named {pool_name!r}. Available: {list(pools)}")
            return
        pool = pools[pool_name]
        pool_label = f"{args.item} / {pool_name}"
    else:
        parser.error("pass --item, --global-pool, or --list-items")
        return

    flat = pool_is_flat(pool)
    if flat:
        print(
            "NOTE: every row in this pool shares the same Weight value -- the site's "
            "'Weight' column here is an available/unavailable flag, not a differentiated "
            "RNG weight. Odds below assume uniform chance among currently-enabled matching "
            "rows; that is NOT a confirmed in-game probability (unlike Memory Revival's "
            "Special Random Affix pool, which does publish real differentiated weights).\n"
        )

    if args.show_pool:
        print(f"=== {pool_label} ({len(pool)} weighted rows) ===")
        for r in pool:
            print(f"  T{r.tier:<4} w={r.weight:<8g} lv{r.level or '-':<4} {r.text}")
        return

    matches = filter_pool(pool, args.target_tier, args.target_text, args.max_level)
    print(f"=== {pool_label} ===")
    print(f"Filter: tier={args.target_tier!r} text={args.target_text!r} max_level={args.max_level}")
    print(f"Matching rows ({len(matches)}):")
    for r in matches[:10]:
        print(f"  - {r.text}")
    if len(matches) > 10:
        print(f"  ... and {len(matches) - 10} more")

    stats = analytic_odds(pool, matches)
    print("\nAnalytic odds (weight-based):")
    print(f"  pool total weight   : {stats['total_weight']:g}")
    print(f"  matching weight     : {stats['matching_weight']:g}")
    print(f"  chance per craft    : {stats['chance_per_craft']:.4%}")
    print(f"  expected attempts   : {stats['expected_attempts']:.1f}")

    if args.trials > 0 and matches:
        mc = monte_carlo(pool, matches, args.trials, args.seed)
        print(f"\nMonte Carlo check ({mc['trials']:,} simulated craft-sessions):")
        print(f"  simulated avg attempts: {mc['simulated_avg_attempts']:.1f}")


if __name__ == "__main__":
    main()
