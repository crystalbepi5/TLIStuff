import { useMemo, useState } from 'react';
import { seedDataset, type AffixTier, type GearSlot } from '@torchlight-companion/build-data';
import { analyticOdds, monteCarloOdds, craftableTiers, type CraftingOdds, type MonteCarloResult } from '@torchlight-companion/build-calc';

const GEAR_SLOTS: GearSlot[] = [
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

const TRIALS = 20_000;

/**
 * A stable per-row identity for React keys and target selection.
 * mapAffixes unions tiers across gear subtypes by modifierId, so the same
 * generic tier label (e.g. "1") can legitimately appear more than once in
 * one affix's tiers array (each subtype's own T1 keeps its own row/weight) --
 * `tier` alone is NOT a unique key. modifierId is the real per-row id when
 * present; the array index is only a fallback for rows that somehow lack it.
 */
function rowKey(t: AffixTier, i: number): string {
  return t.modifierId ?? `${t.tier}-${i}`;
}

function describeModifiers(t: AffixTier): string {
  if (t.modifiers.length === 0) return '(effect text not recognized by the parser)';
  return t.modifiers
    .map((m) => `${m.value >= 0 ? '+' : ''}${m.value}${m.op === 'flat' ? '' : '%'} ${m.stat}`)
    .join(', ');
}

export function CraftingSim() {
  const [slot, setSlot] = useState<GearSlot>('boots');
  const affixesForSlot = useMemo(
    () => seedDataset.affixes.filter((a) => a.slots.includes(slot) && (a.tiers?.length ?? 0) > 0),
    [slot]
  );
  const [affixId, setAffixId] = useState<string>(() => affixesForSlot[0]?.id ?? '');
  const affix = seedDataset.affixes.find((a) => a.id === affixId) ?? affixesForSlot[0];

  const pool = useMemo(() => (affix ? craftableTiers(affix) : []), [affix]);
  const [targetKeys, setTargetKeys] = useState<Set<string>>(new Set());
  const [mc, setMc] = useState<MonteCarloResult | null>(null);

  function pickAffix(id: string) {
    setAffixId(id);
    setTargetKeys(new Set());
    setMc(null);
  }

  function toggleTarget(key: string) {
    setMc(null);
    setTargetKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const matches = pool.filter((t, i) => targetKeys.has(rowKey(t, i)));
  const odds: CraftingOdds | null = pool.length > 0 && matches.length > 0 ? analyticOdds(pool, matches) : null;

  return (
    <div className="planner">
      <header className="planner-header">
        <h1>Crafting Simulator</h1>
        <span className="planner-badge">{seedDataset.meta.source} data</span>
        <a className="planner-nav-link" href="#planner">
          planner
        </a>
        <a className="planner-nav-link" href="#overlay">
          overlay
        </a>
      </header>

      <p className="planner-disclaimer">
        Odds are weight-based from tlicompendium.com's own tier data (each tier's share of the
        affix's total craftable weight) — the same math as the standalone{' '}
        <code>tools/crafting_sim.py</code> tool, cross-checked here with a live Monte Carlo run.
        This does not model which affix appears among a slot's whole prefix/suffix pool, only the
        odds within one chosen affix's own tier ladder.
      </p>

      <div className="planner-grid">
        <section className="planner-panel">
          <h2>Pick an affix</h2>
          <label className="field">
            <span>Gear slot</span>
            <select value={slot} onChange={(e) => { setSlot(e.target.value as GearSlot); setMc(null); }}>
              {GEAR_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Affix ({affixesForSlot.length} craftable)</span>
            <select value={affix?.id ?? ''} onChange={(e) => pickAffix(e.target.value)}>
              {affixesForSlot.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.kind})
                </option>
              ))}
            </select>
          </label>

          {affixesForSlot.length === 0 && <p className="results-error">No craftable-tier affixes found for this slot.</p>}
        </section>

        <section className="planner-panel">
          <h2>Tier ladder — pick a target</h2>
          {pool.length === 0 && affix && <p className="results-error">This affix has no tier/weight data.</p>}
          <table className="tier-table">
            <thead>
              <tr>
                <th>Target</th>
                <th>Tier</th>
                <th>Weight</th>
                <th>Chance</th>
                <th>Effect</th>
              </tr>
            </thead>
            <tbody>
              {pool.map((t, i) => {
                const total = pool.reduce((sum, x) => sum + x.weight, 0);
                const chance = total > 0 ? t.weight / total : 0;
                const key = rowKey(t, i);
                return (
                  <tr key={key}>
                    <td>
                      <input type="checkbox" checked={targetKeys.has(key)} onChange={() => toggleTarget(key)} />
                    </td>
                    <td>T{t.tier}</td>
                    <td>{t.weight}</td>
                    <td>{(chance * 100).toFixed(1)}%</td>
                    <td className="tier-effect">{describeModifiers(t)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="planner-panel planner-results">
          <h2>Odds</h2>
          {!odds && <p className="results-error">Check one or more tiers above to see crafting odds.</p>}
          {odds && (
            <>
              {odds.isFlatPool && (
                <p className="planner-disclaimer">
                  Every tier here shares the same weight — treat this as "uniform among enabled
                  tiers", not a confirmed differentiated in-game probability.
                </p>
              )}
              <div className="stat-big">
                <span className="stat-label">Chance per craft</span>
                <strong>{(odds.chancePerCraft * 100).toFixed(2)}%</strong>
              </div>
              <ul className="stat-list">
                <li>
                  <span>Expected attempts</span>
                  <b>{Number.isFinite(odds.expectedAttempts) ? odds.expectedAttempts.toFixed(1) : '∞'}</b>
                </li>
                <li>
                  <span>Matching / total weight</span>
                  <b>
                    {odds.matchingWeight} / {odds.totalWeight}
                  </b>
                </li>
              </ul>

              <h3>Monte Carlo check</h3>
              <button type="button" onClick={() => setMc(monteCarloOdds(pool, matches, TRIALS))}>
                Simulate {TRIALS.toLocaleString()} crafts
              </button>
              {mc && (
                <ul className="stat-list">
                  <li>
                    <span>Simulated avg attempts</span>
                    <b>{Number.isFinite(mc.avgAttempts) ? mc.avgAttempts.toFixed(1) : '∞'}</b>
                  </li>
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
