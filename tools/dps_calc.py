#!/usr/bin/env python3
"""
DPS calculator SCAFFOLD for Torchlight: Infinite, built on the tlidb.com scrape.

Read this before trusting any number it prints
-----------------------------------------------
Active and support skill detail pages both have a per-level scaling table
(level -> stat value), which this script extracts generically. That part is
real, scraped data.

What this script CANNOT do reliably: combine those numbers into a correct
total DPS. Damage calculators for this genre (PoE, etc.) normally rely on
tooltips using strict keywords -- "increased"/"reduced" stack additively in
a bucket, "more"/"less" stack multiplicatively -- to know how to combine
modifiers. Torchlight: Infinite's own tooltip text does NOT follow that
convention: across the whole scrape, "% more" appears 0 times and
"% increased" appears 9 times (all on an unrelated drop-quantity stat); the
overwhelmingly dominant phrasing is "% additional X damage" (16,780
occurrences), which is ambiguous -- the text alone does not tell you
whether two "additional damage" modifiers add together or multiply.

So: this is a SCAFFOLD, not an oracle. It extracts the real per-level
numbers, and combines everything tagged "stack": "unverified_additive" in
formulas.json with a naive additive sum -- clearly flagged as an assumption
that will overestimate DPS if the true game mechanic multiplies. To get
real numbers, verify each skill/support's actual stacking behavior in-game
or from official patch notes, then add a properly-tagged entry to
formulas.json (see the schema comment at the top of that file).

Usage:
    # See what a skill's level table looks like
    python dps_calc.py --describe Ice_Shot

    # Combine an active skill + supports into a rough estimate
    python dps_calc.py --active Ice_Shot --active-level 20 \\
        --support Multistrike:20 --support Melee_Knockback:20 \\
        --weapon-damage 500
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote

DEFAULT_DATA_DIR = Path(__file__).parent.parent / "scraper_output" / "tlidb_output"
FORMULAS_PATH = Path(__file__).parent / "formulas.json"

FRACTION_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*/\s*(-?\d+(?:\.\d+)?)\s*$")
NUMBER_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$")


def parse_numeric(raw: str) -> float | None:
    if raw is None:
        return None
    raw = str(raw)
    m = FRACTION_RE.match(raw)
    if m:
        num, den = float(m.group(1)), float(m.group(2))
        return num / den if den else None
    m = NUMBER_RE.match(raw)
    if m:
        return float(m.group(1))
    return None


def load_level_table(data_dir: Path, slug: str) -> dict:
    """Generic extractor: find the nested table pane with a 'level' column."""
    slug = unquote(slug)
    path = data_dir / "details" / f"{slug}.json"
    if not path.exists():
        raise FileNotFoundError(f"no detail page cached for {slug!r} at {path}")
    detail = json.loads(path.read_text(encoding="utf-8"))
    for pane in detail.get("nested_listings") or []:
        if pane["kind"] != "table" or not pane["entries"]:
            continue
        if "level" not in pane["entries"][0]:
            continue
        by_level = {}
        columns = [k for k in pane["entries"][0] if k not in ("level", "damage", "Descript")]
        for row in pane["entries"]:
            lvl = int(row["level"])
            by_level[lvl] = {col: parse_numeric(row.get(col)) for col in columns}
        return {"title": detail.get("title"), "pane": pane["title"], "columns": columns, "by_level": by_level}
    raise ValueError(f"{slug!r} has no per-level scaling table")


def describe(data_dir: Path, slug: str) -> None:
    table = load_level_table(data_dir, slug)
    print(f"=== {table['title']} ({table['pane']}) ===")
    print(f"columns: {table['columns']}")
    for lvl in sorted(table["by_level"])[:5]:
        print(f"  level {lvl}: {table['by_level'][lvl]}")
    print(f"  ... {len(table['by_level'])} levels total")
    unparsed = [
        (lvl, col, table["by_level"][lvl][col])
        for lvl in table["by_level"]
        for col in table["columns"]
        if table["by_level"][lvl][col] is None
    ]
    if unparsed:
        print(f"\n  NOTE: {len(unparsed)} cell(s) didn't parse as numeric, e.g. {unparsed[:3]}")


def load_formulas() -> dict:
    if FORMULAS_PATH.exists():
        return json.loads(FORMULAS_PATH.read_text(encoding="utf-8"))
    return {}


def estimate_dps(data_dir: Path, active_slug: str, active_level: int,
                  supports: list[tuple[str, int]], weapon_damage: float) -> None:
    formulas = load_formulas()
    active_table = load_level_table(data_dir, active_slug)
    active_row = active_table["by_level"].get(active_level)
    if active_row is None:
        print(f"No level {active_level} row for {active_slug}; max available level is "
              f"{max(active_table['by_level'])}.")
        return

    eff_col = next((c for c in active_table["columns"] if "Effectiveness" in c), active_table["columns"][0])
    base_pct = active_row.get(eff_col)
    print(f"=== {active_table['title']} @ level {active_level} ===")
    print(f"  base effectiveness ({eff_col}): {base_pct}%")

    total_additional_pct = 0.0
    excluded_unclassified = []
    used_unverified = False
    for slug, lvl in supports:
        table = load_level_table(data_dir, slug)
        row = table["by_level"].get(lvl)
        if row is None:
            print(f"  ! no level {lvl} row for support {slug}, skipping")
            continue
        skill_formula = formulas.get(slug, {})
        columns_meta = skill_formula.get("columns", {})
        contribution = 0.0
        for col, value in row.items():
            if value is None:
                continue
            role = columns_meta.get(col, {}).get("role")
            if role in ("damage_additional", "damage_multiplicative"):
                # NOTE: both roles are summed the same naive way for now --
                # a real multiplicative combine isn't implemented yet, this
                # only tracks that someone has classified the column at all.
                contribution += value
                used_unverified = used_unverified or columns_meta[col].get("stack") == "unverified_additive"
            else:
                excluded_unclassified.append((slug, col, value))
        total_additional_pct += contribution
        print(f"  + {slug} (lvl {lvl}): {contribution:+.1f}% classified-damage contribution")

    if excluded_unclassified:
        print(f"\n  EXCLUDED from the total (no 'role' classification in formulas.json, "
              f"so not safe to assume it's a damage%% modifier):")
        for slug, col, value in excluded_unclassified:
            print(f"    - {slug}: {col!r} = {value}")

    final_multiplier = (base_pct / 100.0) * (1 + total_additional_pct / 100.0)
    final_damage = weapon_damage * final_multiplier

    print(f"\n  weapon damage input      : {weapon_damage}")
    print(f"  naive combined multiplier: {final_multiplier:.3f}")
    print(f"  ROUGH damage estimate    : {final_damage:.1f}")

    if used_unverified or excluded_unclassified:
        print(
            "\n  WARNING: this estimate only includes columns explicitly classified as "
            "'damage_additional'/'damage_multiplicative' in formulas.json, naively summed "
            "regardless of which of those two roles they have (a true multiplicative combine "
            "isn't implemented). Anything excluded above needs a real classification -- and "
            "everything included is only as correct as the classification you gave it.",
            file=sys.stderr,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--describe", help="Print a skill's level table and exit")
    parser.add_argument("--active", help="Active skill slug, e.g. Ice_Shot")
    parser.add_argument("--active-level", type=int, default=20)
    parser.add_argument("--support", action="append", default=[], help="SUPPORT_SLUG:LEVEL, repeatable")
    parser.add_argument("--weapon-damage", type=float, default=100.0)
    args = parser.parse_args()

    try:
        if args.describe:
            describe(args.data_dir, args.describe)
            return

        if not args.active:
            parser.error("pass --active or --describe")
            return

        supports = []
        for s in args.support:
            slug, _, lvl = s.rpartition(":")
            supports.append((slug, int(lvl)))

        estimate_dps(args.data_dir, args.active, args.active_level, supports, args.weapon_damage)
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
