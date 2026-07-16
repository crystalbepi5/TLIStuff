# Crafting simulator + DPS calculator scaffold

Built on top of the tlidb.com scrape (`../scraper/scrape_tlidb.py`). Both tools
read directly from a scrape output directory (`--data-dir`, defaults to
`../scraper_output/tlidb_output` relative to this folder — point it at
wherever you unzipped the scraped data, e.g. the `tlidb_output` folder from
the delivered zip).

## crafting_sim.py

Monte Carlo simulator for the crafting subsystems that publish a real "Weight"
column: regular gear crafting (per item base, e.g. `Vorax_Limb:_Hands`) and
Memory Revival's global pools. Also has a deterministic lookup for Enchant,
which isn't RNG at all (fixed cost/quality ladder).

```
python crafting_sim.py --list-items
python crafting_sim.py --item "Vorax_Limb:_Hands" --show-pool
python crafting_sim.py --item "Vorax_Limb:_Hands" --target-tier 0 --trials 200000
python crafting_sim.py --global-pool "Special Random Affix" --target-text "Resistance"
python crafting_sim.py --enchant-type "Added % of Cold Damage as Erosion Damage"
```

**Important caveat:** on the per-item gear tables, every enabled row shares
the same Weight value — it's an available/unavailable flag, not a
differentiated RNG weight. The tool prints a warning when it detects this and
the resulting "odds" assume uniform chance among enabled+matching rows. Only
Memory Revival's "Special Random Affix" pool publishes genuinely different
weights per row.

## dps_calc.py

Extracts each skill's real per-level scaling table, but does **not** reliably
know how to combine active + support skills into a true DPS number — see the
big caveat in the file's docstring: Torchlight: Infinite's tooltips don't use
PoE-style "increased"/"more" keywords, so additive-vs-multiplicative stacking
isn't machine-derivable from the scraped text. Treat this as a scaffold:

```
python dps_calc.py --describe Ice_Shot
python dps_calc.py --active Ice_Shot --active-level 20 --support Multistrike:20 --weapon-damage 500
```

To make a support's numbers actually count toward the total, add a
hand-verified entry to `formulas.json` classifying each of its columns
(`damage_additional` / `damage_multiplicative` / `proc_chance` / etc.) —
anything unclassified is excluded from the total and listed separately so
nothing gets silently miscounted as damage.
