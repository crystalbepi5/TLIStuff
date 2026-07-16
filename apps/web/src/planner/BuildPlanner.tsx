import { useMemo, useState } from 'react';
import {
  seedDataset,
  indexDataset,
  type Build,
  type GearPiece,
  type GearSlot,
  type VoraxAffix,
  type VoraxGearPiece,
  type VoraxLegendary
} from '@torchlight-companion/build-data';
import { evaluateBuild, MAX_PACT_SPIRITS, totalManaCost } from '@torchlight-companion/build-calc';
import { ProgressionTreeGraph } from '../progression/ProgressionTreeGraph';

/** Vorax affixes/legendaries have no `name` field in the scraped data (the
 * game never labels them individually the way regular affixes are) -- these
 * synthesize a readable option label from the modifiers themselves, the same
 * "describe from modifiers" pattern the crafting sim page uses. */
function describeVoraxModifiers(modifiers: { stat: string; op: string; value: number }[]): string {
  if (modifiers.length === 0) return '(no modeled effect yet)';
  return modifiers
    .map((m) => `${m.value >= 0 ? '+' : ''}${m.value}${m.op === 'flat' ? '' : '%'} ${m.stat}`)
    .join(', ');
}

function voraxAffixLabel(a: VoraxAffix): string {
  return describeVoraxModifiers(a.modifiers);
}

function voraxLegendaryLabel(l: VoraxLegendary): string {
  return describeVoraxModifiers(l.modifiers);
}

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

const index = indexDataset(seedDataset);

/** Cap how many unselected matches a filtered list renders, to keep the DOM
 * light when the dataset has hundreds of entries. */
const LIST_LIMIT = 60;

function defaultBuild(): Build {
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
function filterList<T extends { id: string; name: string }>(
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

function encodeBuild(build: Build): string {
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
function decodeBuild(code: string): Build {
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
function shareUrl(build: Build): string {
  const url = new URL(window.location.href);
  url.hash = 'planner';
  url.searchParams.set('build', encodeBuild(build));
  return url.toString();
}

/** Reads `?build=` from the current URL, if present — used once on load so a
 * shared link opens directly onto that build instead of the blank default. */
function buildFromUrl(): Build | undefined {
  const code = new URLSearchParams(window.location.search).get('build');
  if (!code) return undefined;
  try {
    return decodeBuild(code);
  } catch {
    return undefined;
  }
}

export function BuildPlanner() {
  const [build, setBuild] = useState<Build>(() => buildFromUrl() ?? defaultBuild());
  const [shareCode, setShareCode] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [supportSearch, setSupportSearch] = useState('');
  const [talentSearch, setTalentSearch] = useState('');

  const [progressionCategory, setProgressionCategory] = useState<'talentTrees' | 'voidCharts'>('talentTrees');
  const [progressionTreeId, setProgressionTreeId] = useState<string>('');

  const skill = index.activeSkill(build.activeSkillId);
  const supportSlots = skill?.supportSlots ?? 0;
  const manaCost = skill
    ? totalManaCost(
        skill,
        build.supportIds.map((id) => index.supportSkill(id))
      )
    : 0;

  const report = useMemo(() => {
    try {
      return evaluateBuild(build, index);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [build]);

  function patch(next: Partial<Build>) {
    setBuild((prev) => ({ ...prev, ...next }));
  }

  function toggleSupport(id: string) {
    setBuild((prev) => {
      const has = prev.supportIds.includes(id);
      if (has) return { ...prev, supportIds: prev.supportIds.filter((s) => s !== id) };
      if (prev.supportIds.length >= supportSlots) return prev; // slots full
      return { ...prev, supportIds: [...prev.supportIds, id] };
    });
  }

  function toggleInList(
    key: 'talentIds' | 'pactSpiritIds' | 'memoryIds',
    id: string,
    cap?: number
  ) {
    setBuild((prev) => {
      const list = prev[key];
      if (list.includes(id)) return { ...prev, [key]: list.filter((x) => x !== id) };
      if (cap !== undefined && list.length >= cap) return prev;
      return { ...prev, [key]: [...list, id] };
    });
  }

  function setGear(slot: GearSlot, piece: GearPiece | null) {
    setBuild((prev) => {
      const rest = prev.gear.filter((g) => g.slot !== slot);
      return { ...prev, gear: piece ? [...rest, piece] : rest };
    });
  }

  const gearBySlot = (slot: GearSlot) => build.gear.find((g) => g.slot === slot);

  function setVoraxGear(limb: string, piece: VoraxGearPiece | null) {
    setBuild((prev) => {
      const rest = prev.voraxGear.filter((g) => g.limb !== limb);
      return { ...prev, voraxGear: piece ? [...rest, piece] : rest };
    });
  }

  const voraxGearByLimb = (limb: string) => build.voraxGear.find((g) => g.limb === limb);

  function toggleProgressionNode(category: 'talentTrees' | 'voidCharts', nodeId: string) {
    const key = category === 'talentTrees' ? 'talentTreeNodeIds' : 'voidChartNodeIds';
    setBuild((prev) => {
      const list = prev[key];
      return {
        ...prev,
        [key]: list.includes(nodeId) ? list.filter((x) => x !== nodeId) : [...list, nodeId]
      };
    });
  }

  return (
    <div className="planner">
      <header className="planner-header">
        <h1>Build Planner</h1>
        <span className="planner-badge">{seedDataset.meta.source} data</span>
        <a className="planner-nav-link" href="#craft">
          crafting sim
        </a>
        <a className="planner-nav-link" href="#overlay">
          ← overlay
        </a>
      </header>

      <p className="planner-disclaimer">
        Data is scraped from tlicompendium.com. The damage <strong>formula</strong>'s core structure
        (summed "increased" bonuses, then each "additional"/"more" bonus as its own multiplier) is
        confirmed against{' '}
        <a href="https://tlidb.com/vi/Damage_Calculation" target="_blank" rel="noreferrer">
          tlidb.com's own Damage Calculation page
        </a>
        — crit, exact per-skill numbers, and effects the calculator doesn't model yet are still
        approximations. Treat DPS as a <strong>relative</strong> indicator, not exact in-game truth.
      </p>

      <div className="planner-grid">
        <section className="planner-panel">
          <h2>Character</h2>
          <label className="field">
            <span>Hero</span>
            <select
              value={build.heroId}
              onChange={(e) => patch({ heroId: e.target.value, talentIds: [] })}
            >
              {seedDataset.heroes.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                  {h.season ? ` (${h.season})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Main Skill</span>
            <select
              value={build.activeSkillId}
              onChange={(e) => patch({ activeSkillId: e.target.value, supportIds: [] })}
            >
              {seedDataset.activeSkills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} [{s.tags.join(', ')}]
                </option>
              ))}
            </select>
          </label>

          <h3>
            Supports ({build.supportIds.length}/{supportSlots})
            <span className="req-tags"> · Mana Cost: {manaCost.toFixed(1)}</span>
          </h3>
          <input
            className="list-search"
            type="search"
            placeholder={`Search ${seedDataset.supportSkills.length} supports…`}
            value={supportSearch}
            onChange={(e) => setSupportSearch(e.target.value)}
          />
          {(() => {
            const { shown, hidden } = filterList(
              seedDataset.supportSkills,
              build.supportIds,
              supportSearch
            );
            return (
              <div className="checkbox-list">
                {shown.map((sup) => {
                  const checked = build.supportIds.includes(sup.id);
                  const disabled = !checked && build.supportIds.length >= supportSlots;
                  return (
                    <label key={sup.id} className={`checkbox ${disabled ? 'is-disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleSupport(sup.id)}
                      />
                      <span>{sup.name}</span>
                      {sup.requiresTags.length > 0 && (
                        <em className="req-tags">needs {sup.requiresTags.join('/')}</em>
                      )}
                    </label>
                  );
                })}
                {hidden > 0 && <div className="list-more">+{hidden} more — refine search</div>}
                {shown.length === 0 && <div className="list-more">no matches</div>}
              </div>
            );
          })()}
        </section>

        <section className="planner-panel">
          <h2>Gear</h2>
          {GEAR_SLOTS.map((slot) => {
            const bases = seedDataset.gearBases.filter((g) => g.slot === slot);
            if (bases.length === 0) return null;
            const piece = gearBySlot(slot);
            const affixes = seedDataset.affixes.filter((a) => a.slots.includes(slot));
            return (
              <div key={slot} className="gear-row">
                <div className="gear-slot-name">{slot}</div>
                <select
                  value={piece?.baseId ?? ''}
                  onChange={(e) => {
                    const baseId = e.target.value;
                    setGear(slot, baseId ? { slot, baseId, affixIds: piece?.affixIds ?? [] } : null);
                  }}
                >
                  <option value="">— none —</option>
                  {bases.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {piece && affixes.length > 0 && (
                  <div className="affix-list">
                    {affixes.map((a) => {
                      const on = piece.affixIds.includes(a.id);
                      return (
                        <label key={a.id} className="chip">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setGear(slot, {
                                ...piece,
                                affixIds: on
                                  ? piece.affixIds.filter((x) => x !== a.id)
                                  : [...piece.affixIds, a.id]
                              })
                            }
                          />
                          <span>{a.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="planner-panel">
          <h2>Vorax Gear</h2>
          <p className="planner-disclaimer">
            An extra limb slot worn in addition to normal gear. Affixes with no recognized effect
            (the parser couldn't map their text to a modeled stat) are hidden from these lists to
            keep them usable — the raw tier/weight data is still there for the crafting sim.
          </p>
          {(() => {
            const allLimbs = [
              ...new Set([
                ...(seedDataset.voraxAffixes ?? []).map((a) => a.limb),
                ...(seedDataset.voraxLegendaries ?? []).map((l) => l.limb)
              ])
            ].sort();
            return allLimbs.map((limb) => {
              const legendaries = (seedDataset.voraxLegendaries ?? []).filter(
                (l) => l.limb === limb && l.modifiers.length > 0
              );
              const affixes = (seedDataset.voraxAffixes ?? []).filter(
                (a) => a.limb === limb && a.modifiers.length > 0
              );
              const piece = voraxGearByLimb(limb);
              return (
                <div key={limb} className="gear-row">
                  <div className="gear-slot-name">{limb}</div>
                  <select
                    value={piece?.legendaryId ?? ''}
                    onChange={(e) => {
                      const legendaryId = e.target.value;
                      setVoraxGear(
                        limb,
                        legendaryId || (piece?.affixIds.length ?? 0) > 0
                          ? { limb, affixIds: piece?.affixIds ?? [], ...(legendaryId ? { legendaryId } : {}) }
                          : null
                      );
                    }}
                  >
                    <option value="">— no legendary —</option>
                    {legendaries.map((l) => (
                      <option key={l.id} value={l.id}>
                        {voraxLegendaryLabel(l)}
                      </option>
                    ))}
                  </select>
                  {affixes.length > 0 && (
                    <div className="affix-list">
                      {affixes.slice(0, 20).map((a) => {
                        const on = piece?.affixIds.includes(a.id) ?? false;
                        return (
                          <label key={a.id} className="chip">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => {
                                const current = piece ?? { limb, affixIds: [] };
                                const affixIds = on
                                  ? current.affixIds.filter((x) => x !== a.id)
                                  : [...current.affixIds, a.id];
                                setVoraxGear(limb, { ...current, affixIds });
                              }}
                            />
                            <span>{voraxAffixLabel(a)}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </section>

        <section className="planner-panel">
          <h2>Progression</h2>

          <h3>Talents</h3>
          <input
            className="list-search"
            type="search"
            placeholder="Search talents…"
            value={talentSearch}
            onChange={(e) => setTalentSearch(e.target.value)}
          />
          {(() => {
            const eligible = seedDataset.talents.filter(
              (t) => t.heroId === 'any' || t.heroId === build.heroId
            );
            const { shown, hidden } = filterList(eligible, build.talentIds, talentSearch);
            return (
              <div className="checkbox-list">
                {shown.map((t) => (
                  <label key={t.id} className="checkbox">
                    <input
                      type="checkbox"
                      checked={build.talentIds.includes(t.id)}
                      onChange={() => toggleInList('talentIds', t.id)}
                    />
                    <span>{t.name}</span>
                    {t.heroId === 'any' && <em className="req-tags">shared</em>}
                  </label>
                ))}
                {hidden > 0 && <div className="list-more">+{hidden} more — refine search</div>}
              </div>
            );
          })()}

          <h3>
            Pact Spirits ({build.pactSpiritIds.length}/{MAX_PACT_SPIRITS})
          </h3>
          <div className="checkbox-list">
            {seedDataset.pactSpirits.map((p) => {
              const checked = build.pactSpiritIds.includes(p.id);
              const disabled = !checked && build.pactSpiritIds.length >= MAX_PACT_SPIRITS;
              return (
                <label key={p.id} className={`checkbox ${disabled ? 'is-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleInList('pactSpiritIds', p.id, MAX_PACT_SPIRITS)}
                  />
                  <span>{p.name}</span>
                </label>
              );
            })}
          </div>

          <h3>Memory Revival</h3>
          <div className="checkbox-list">
            {seedDataset.memories.map((m) => (
              <label key={m.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={build.memoryIds.includes(m.id)}
                  onChange={() => toggleInList('memoryIds', m.id)}
                />
                <span>{m.name}</span>
                {m.season && <em className="req-tags">{m.season}</em>}
              </label>
            ))}
          </div>
        </section>

        <section className="planner-panel">
          <h2>Progression Trees</h2>
          <p className="planner-disclaimer">
            Real node graphs (position + connections) scraped straight from the game's own data --
            not available from any HTML-only scrape. Most Void Chart nodes have no modeled effect
            yet (best-effort text parsing only recognizes a small fraction of them); Talent Tree
            nodes fare much better. No point-budget or prerequisite gating is enforced since neither
            is confirmed against the real game — every node stays freely toggleable.
          </p>
          <label className="field">
            <span>Category</span>
            <select
              value={progressionCategory}
              onChange={(e) => {
                setProgressionCategory(e.target.value as 'talentTrees' | 'voidCharts');
                setProgressionTreeId('');
              }}
            >
              <option value="talentTrees">Talent Trees ({(seedDataset.talentTrees ?? []).length})</option>
              <option value="voidCharts">Void Chart ({(seedDataset.voidCharts ?? []).length})</option>
            </select>
          </label>
          {(() => {
            const trees = seedDataset[progressionCategory] ?? [];
            const tree = trees.find((t) => t.id === progressionTreeId) ?? trees[0];
            const selectedIds = new Set(
              progressionCategory === 'talentTrees' ? build.talentTreeNodeIds : build.voidChartNodeIds
            );
            return (
              <>
                <label className="field">
                  <span>Tree</span>
                  <select value={tree?.id ?? ''} onChange={(e) => setProgressionTreeId(e.target.value)}>
                    {trees.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.nodes.length} nodes)
                      </option>
                    ))}
                  </select>
                </label>
                {tree && (
                  <ProgressionTreeGraph
                    tree={tree}
                    selectedIds={selectedIds}
                    onToggle={(nodeId) => toggleProgressionNode(progressionCategory, nodeId)}
                  />
                )}
              </>
            );
          })()}
        </section>

        <section className="planner-panel planner-results">
          <h2>Results</h2>
          {'error' in report ? (
            <p className="results-error">{report.error}</p>
          ) : (
            <>
              <div className="stat-big">
                <span className="stat-label">DPS</span>
                <strong>{Math.round(report.damage.dps).toLocaleString()}</strong>
              </div>
              <ul className="stat-list">
                <li>
                  <span>Average hit</span>
                  <b>{Math.round(report.damage.averageHit).toLocaleString()}</b>
                </li>
                <li>
                  <span>Crit rate</span>
                  <b>{report.damage.critRate.toFixed(1)}%</b>
                </li>
                <li>
                  <span>Crit multi</span>
                  <b>{report.damage.critMultiplier.toFixed(2)}×</b>
                </li>
                <li>
                  <span>Rate</span>
                  <b>{report.damage.rate.toFixed(2)}/s</b>
                </li>
              </ul>

              <h3>Damage by element</h3>
              <ul className="stat-list">
                {Object.entries(report.damage.perElement).map(([el, dmg]) => (
                  <li key={el}>
                    <span className={`el el-${el}`}>{el}</span>
                    <b>{Math.round(dmg as number).toLocaleString()}</b>
                  </li>
                ))}
              </ul>

              <h3>Defence</h3>
              <ul className="stat-list">
                <li>
                  <span>Life</span>
                  <b>{Math.round(report.defense.life).toLocaleString()}</b>
                </li>
                <li>
                  <span>Energy shield</span>
                  <b>{Math.round(report.defense.energyShield).toLocaleString()}</b>
                </li>
                <li>
                  <span>Eff. HP (elemental)</span>
                  <b>{Math.round(report.defense.effectiveHpVsElemental).toLocaleString()}</b>
                </li>
                {Object.entries(report.defense.resists).map(([el, val]) => (
                  <li key={el}>
                    <span className={`el el-${el}`}>{el} res</span>
                    <b>{val}%</b>
                  </li>
                ))}
              </ul>

              {report.warnings.length > 0 && (
                <div className="warnings">
                  <h3>Warnings</h3>
                  <ul>
                    {report.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <section className="planner-panel share-panel">
        <h2>Share</h2>
        <div className="share-row">
          <button
            type="button"
            onClick={async () => {
              const url = shareUrl(build);
              try {
                await navigator.clipboard.writeText(url);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              } catch {
                setShareCode(url); // clipboard unavailable — fall back to the textarea
              }
            }}
          >
            {linkCopied ? 'Link copied!' : 'Copy share link'}
          </button>
          <button type="button" onClick={() => setShareCode(encodeBuild(build))}>
            Export code
          </button>
          <button
            type="button"
            onClick={() => {
              setImportError(null);
              try {
                setBuild(decodeBuild(shareCode));
              } catch {
                setImportError('Could not decode that build code.');
              }
            }}
          >
            Import code
          </button>
        </div>
        <textarea
          className="share-code"
          value={shareCode}
          placeholder="Export to generate a share code, or paste one here and Import."
          onChange={(e) => setShareCode(e.target.value)}
        />
        {importError && <p className="results-error">{importError}</p>}
      </section>
    </div>
  );
}
