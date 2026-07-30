import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Copy, Download, Upload } from 'lucide-react';
import { seedDataset, type Build, type GearPiece, type GearSlot, type VoraxGearPiece } from '@torchlight-companion/build-data';
import {
  evaluateBuild,
  marginalGearAnalysis,
  MAX_PACT_SPIRITS,
  totalManaCost,
  type AffixSwapSuggestion
} from '@torchlight-companion/build-calc';
import { ProgressionTreeGraph } from '../progression/ProgressionTreeGraph';
import { PlannerShell } from './PlannerShell';
import { PlannerHeader } from './PlannerHeader';
import { PlannerNavigation } from './PlannerNavigation';
import { PlannerStatsRail } from './PlannerStatsRail';
import type { PlannerSection } from './plannerSections';
import { PlannerProvider, usePlanner } from './context/PlannerContext';
import { GEAR_SLOTS, index, decodeBuild, encodeBuild, filterList, shareUrl, voraxAffixLabel, voraxLegendaryLabel } from './buildUtils';
import './planner.css';

export function BuildPlanner() {
  return (
    <PlannerProvider>
      <PlannerApp />
    </PlannerProvider>
  );
}

function PlannerApp() {
  const {
    build,
    activeSection,
    setActiveSection,
    patchBuild,
    loadBuild,
    resetBuild,
    undo,
    redo,
    canUndo,
    canRedo,
    saveStatus
  } = usePlanner();

  const [navCollapsed, setNavCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railOpenMobile, setRailOpenMobile] = useState(false);

  const [shareCode, setShareCode] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [supportSearch, setSupportSearch] = useState('');
  const [talentSearch, setTalentSearch] = useState('');

  const [progressionCategory, setProgressionCategory] = useState<'talentTrees' | 'voidCharts'>('talentTrees');
  const [progressionTreeId, setProgressionTreeId] = useState<string>('');

  const hero = index.hero(build.heroId);
  const skill = index.activeSkill(build.activeSkillId);
  const supportSlots = skill?.supportSlots ?? 0;
  const manaCost = skill
    ? totalManaCost(
        skill,
        build.supportIds.map((id) => index.supportSkill(id))
      )
    : 0;

  let report: ReturnType<typeof evaluateBuild> | { error: string };
  try {
    report = evaluateBuild(build, index);
  } catch (err) {
    report = { error: err instanceof Error ? err.message : String(err) };
  }

  // On-demand (not recomputed on every build change): each run is O(equipped
  // affixes x candidate pool per slot) evaluateBuild calls -- cheap once, but
  // wasteful to redo on every keystroke/toggle the way the main report is.
  const [marginal, setMarginal] = useState<AffixSwapSuggestion[] | null>(null);
  const [marginalBusy, setMarginalBusy] = useState(false);
  useEffect(() => {
    setMarginal(null); // stale once the build changes -- a suggestion names a specific equipped affix to swap
  }, [build]);

  function runMarginalAnalysis() {
    setMarginalBusy(true);
    // Yield to a render so the "Analyzing…" state actually paints first.
    setTimeout(() => {
      setMarginal(marginalGearAnalysis(build, index, seedDataset.affixes, 5));
      setMarginalBusy(false);
    }, 0);
  }

  function toggleSupport(id: string) {
    patchBuild((prev) => {
      const has = prev.supportIds.includes(id);
      if (has) return { supportIds: prev.supportIds.filter((s) => s !== id) };
      if (prev.supportIds.length >= supportSlots) return {}; // slots full
      return { supportIds: [...prev.supportIds, id] };
    });
  }

  function toggleInList(key: 'talentIds' | 'pactSpiritIds' | 'memoryIds', id: string, cap?: number) {
    patchBuild((prev) => {
      const list = prev[key];
      if (list.includes(id)) return { [key]: list.filter((x) => x !== id) };
      if (cap !== undefined && list.length >= cap) return {};
      return { [key]: [...list, id] };
    });
  }

  function setGear(slot: GearSlot, piece: GearPiece | null) {
    patchBuild((prev) => {
      const rest = prev.gear.filter((g) => g.slot !== slot);
      return { gear: piece ? [...rest, piece] : rest };
    });
  }

  const gearBySlot = (slot: GearSlot) => build.gear.find((g) => g.slot === slot);

  function setVoraxGear(limb: string, piece: VoraxGearPiece | null) {
    patchBuild((prev) => {
      const rest = prev.voraxGear.filter((g) => g.limb !== limb);
      return { voraxGear: piece ? [...rest, piece] : rest };
    });
  }

  const voraxGearByLimb = (limb: string) => build.voraxGear.find((g) => g.limb === limb);

  function toggleProgressionNode(category: 'talentTrees' | 'voidCharts', nodeId: string) {
    const key = category === 'talentTrees' ? 'talentTreeNodeIds' : 'voidChartNodeIds';
    patchBuild((prev) => {
      const list = prev[key];
      return { [key]: list.includes(nodeId) ? list.filter((x) => x !== nodeId) : [...list, nodeId] };
    });
  }

  return (
    <PlannerShell
      navCollapsed={navCollapsed}
      railCollapsed={railCollapsed}
      railOpenMobile={railOpenMobile}
      header={
        <PlannerHeader
          buildName={build.name}
          onBuildNameChange={(name) => patchBuild({ name }, { groupKey: 'buildName' })}
          dataSource={seedDataset.meta.source}
          navCollapsed={navCollapsed}
          onToggleNav={() => setNavCollapsed((c) => !c)}
          onToggleRail={() => {
            setRailCollapsed((c) => !c);
            setRailOpenMobile((o) => !o);
          }}
          saveStatus={saveStatus}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onNewBuild={() => {
            if (window.confirm('Start a new build? This clears the current build, including its undo history.')) {
              resetBuild();
            }
          }}
        />
      }
      nav={
        <PlannerNavigation active={activeSection} collapsed={navCollapsed} onSelect={setActiveSection} />
      }
      rail={
        <PlannerStatsRail
          report={report}
          marginal={marginal}
          marginalBusy={marginalBusy}
          hasGear={build.gear.length > 0}
          onRunMarginalAnalysis={runMarginalAnalysis}
        />
      }
      main={
        <div className="pv-workspace-enter" key={activeSection}>
          {activeSection === 'overview' && (
            <OverviewSection build={build} hero={hero?.name} skill={skill?.name} report={report} onNavigate={setActiveSection} />
          )}

          {activeSection === 'hero' && (
            <section className="pv-panel">
              <div className="pv-panel-header">
                <h2 className="pv-section-title">Hero</h2>
              </div>
              <div className="pv-panel-body">
                <div className="pv-field">
                  <label className="pv-field-label" htmlFor="hero-select">
                    Hero
                  </label>
                  <select
                    id="hero-select"
                    className="pv-select"
                    value={build.heroId}
                    onChange={(e) => patchBuild({ heroId: e.target.value, talentIds: [] })}
                  >
                    {seedDataset.heroes.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                        {h.season ? ` (${h.season})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="pv-metadata" style={{ marginTop: 8 }}>
                  Changing hero clears selected talents, since talent eligibility is hero-specific.
                </p>
              </div>
            </section>
          )}

          {activeSection === 'skills' && (
            <section className="pv-panel">
              <div className="pv-panel-header">
                <h2 className="pv-section-title">Skills</h2>
                <span className="pv-badge">Mana cost {manaCost.toFixed(1)}</span>
              </div>
              <div className="pv-panel-body">
                <div className="pv-field">
                  <label className="pv-field-label" htmlFor="skill-select">
                    Main skill
                  </label>
                  <select
                    id="skill-select"
                    className="pv-select"
                    value={build.activeSkillId}
                    onChange={(e) => patchBuild({ activeSkillId: e.target.value, supportIds: [] })}
                  >
                    {seedDataset.activeSkills.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} [{s.tags.join(', ')}]
                      </option>
                    ))}
                  </select>
                </div>

                <hr className="pv-divider" />
                <div className="pv-panel-header" style={{ padding: 0, border: 'none' }}>
                  <span className="pv-panel-label">
                    Supports ({build.supportIds.length}/{supportSlots})
                  </span>
                </div>
                <div className="pv-search" style={{ margin: '8px 0' }}>
                  <input
                    type="search"
                    placeholder={`Search ${seedDataset.supportSkills.length} supports…`}
                    value={supportSearch}
                    onChange={(e) => setSupportSearch(e.target.value)}
                  />
                </div>
                {(() => {
                  const { shown, hidden } = filterList(seedDataset.supportSkills, build.supportIds, supportSearch);
                  return (
                    <div className="pv-scroll-region" style={{ maxHeight: 420 }}>
                      {shown.map((sup) => {
                        const checked = build.supportIds.includes(sup.id);
                        const disabled = !checked && build.supportIds.length >= supportSlots;
                        return (
                          <label key={sup.id} className="pv-checkbox-row" style={{ opacity: disabled ? 0.45 : 1 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleSupport(sup.id)}
                            />
                            <span>{sup.name}</span>
                            {sup.requiresTags.length > 0 && (
                              <em className="pv-metadata">needs {sup.requiresTags.join('/')}</em>
                            )}
                          </label>
                        );
                      })}
                      {hidden > 0 && <p className="pv-metadata">+{hidden} more — refine search</p>}
                      {shown.length === 0 && <p className="pv-metadata">no matches</p>}
                    </div>
                  );
                })()}
              </div>
            </section>
          )}

          {activeSection === 'equipment' && (
            <section className="pv-panel">
              <div className="pv-panel-header">
                <h2 className="pv-section-title">Equipment</h2>
              </div>
              <div className="pv-panel-body" style={{ display: 'grid', gap: 12 }}>
                {GEAR_SLOTS.map((slot) => {
                  const bases = seedDataset.gearBases.filter((g) => g.slot === slot);
                  if (bases.length === 0) return null;
                  const piece = gearBySlot(slot);
                  const affixes = seedDataset.affixes.filter((a) => a.slots.includes(slot));
                  return (
                    <div key={slot} className="pv-card" style={{ padding: 10 }}>
                      <div className="pv-field-label" style={{ marginBottom: 6, textTransform: 'capitalize' }}>
                        {slot}
                        {slot === 'ring' && (
                          <span className="pv-metadata" style={{ textTransform: 'none', marginLeft: 6 }}>
                            (single ring slot — see known limitations)
                          </span>
                        )}
                      </div>
                      <select
                        className="pv-select"
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
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {affixes.map((a) => {
                            const on = piece.affixIds.includes(a.id);
                            return (
                              <label
                                key={a.id}
                                className="pv-badge pv-badge-btn"
                                style={on ? { color: 'var(--pv-accent)', borderColor: 'var(--pv-accent)' } : undefined}
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  className="pv-visually-hidden"
                                  onChange={() =>
                                    setGear(slot, {
                                      ...piece,
                                      affixIds: on ? piece.affixIds.filter((x) => x !== a.id) : [...piece.affixIds, a.id]
                                    })
                                  }
                                />
                                {a.name}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {activeSection === 'talents' && (
            <section className="pv-panel">
              <div className="pv-panel-header">
                <h2 className="pv-section-title">Talents</h2>
              </div>
              <div className="pv-panel-body">
                <div className="pv-search" style={{ marginBottom: 8 }}>
                  <input
                    type="search"
                    placeholder="Search talents…"
                    value={talentSearch}
                    onChange={(e) => setTalentSearch(e.target.value)}
                  />
                </div>
                {(() => {
                  const eligible = seedDataset.talents.filter((t) => t.heroId === 'any' || t.heroId === build.heroId);
                  const { shown, hidden } = filterList(eligible, build.talentIds, talentSearch);
                  return (
                    <div className="pv-scroll-region" style={{ maxHeight: 520 }}>
                      {shown.map((t) => (
                        <label key={t.id} className="pv-checkbox-row">
                          <input
                            type="checkbox"
                            checked={build.talentIds.includes(t.id)}
                            onChange={() => toggleInList('talentIds', t.id)}
                          />
                          <span>{t.name}</span>
                          {t.heroId === 'any' && <em className="pv-metadata">shared</em>}
                        </label>
                      ))}
                      {hidden > 0 && <p className="pv-metadata">+{hidden} more — refine search</p>}
                    </div>
                  );
                })()}
              </div>
            </section>
          )}

          {activeSection === 'progressionTrees' && (
            <section className="pv-panel">
              <div className="pv-panel-header">
                <h2 className="pv-section-title">Progression Trees</h2>
              </div>
              <div className="pv-panel-body">
                <p className="pv-metadata" style={{ marginBottom: 10 }}>
                  Real node graphs (position + connections) scraped from the game's own data. Most
                  Void Chart nodes have no modeled effect yet (best-effort text parsing only
                  recognizes a small fraction of them); Talent Tree nodes fare much better. No
                  point-budget or prerequisite gating is enforced since neither is confirmed against
                  the real game — every node stays freely toggleable.
                </p>
                <div className="pv-field">
                  <label className="pv-field-label" htmlFor="progression-category">
                    Category
                  </label>
                  <select
                    id="progression-category"
                    className="pv-select"
                    value={progressionCategory}
                    onChange={(e) => {
                      setProgressionCategory(e.target.value as 'talentTrees' | 'voidCharts');
                      setProgressionTreeId('');
                    }}
                  >
                    <option value="talentTrees">
                      Talent Trees ({(seedDataset.talentTrees ?? []).length})
                    </option>
                    <option value="voidCharts">Void Chart ({(seedDataset.voidCharts ?? []).length})</option>
                  </select>
                </div>
                {(() => {
                  const trees = seedDataset[progressionCategory] ?? [];
                  const tree = trees.find((t) => t.id === progressionTreeId) ?? trees[0];
                  const selectedIds = new Set(
                    progressionCategory === 'talentTrees' ? build.talentTreeNodeIds : build.voidChartNodeIds
                  );
                  return (
                    <>
                      <div className="pv-field" style={{ marginTop: 10 }}>
                        <label className="pv-field-label" htmlFor="progression-tree">
                          Tree
                        </label>
                        <select
                          id="progression-tree"
                          className="pv-select"
                          value={tree?.id ?? ''}
                          onChange={(e) => setProgressionTreeId(e.target.value)}
                        >
                          {trees.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.nodes.length} nodes)
                            </option>
                          ))}
                        </select>
                      </div>
                      {tree && (
                        <div style={{ marginTop: 10 }}>
                          <ProgressionTreeGraph
                            tree={tree}
                            selectedIds={selectedIds}
                            onToggle={(nodeId) => toggleProgressionNode(progressionCategory, nodeId)}
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </section>
          )}

          {activeSection === 'pactSpirits' && (
            <section className="pv-panel">
              <div className="pv-panel-header">
                <h2 className="pv-section-title">Pact Spirits</h2>
                <span className="pv-badge">
                  {build.pactSpiritIds.length}/{MAX_PACT_SPIRITS}
                </span>
              </div>
              <div className="pv-panel-body">
                {seedDataset.pactSpirits.map((p) => {
                  const checked = build.pactSpiritIds.includes(p.id);
                  const disabled = !checked && build.pactSpiritIds.length >= MAX_PACT_SPIRITS;
                  return (
                    <label key={p.id} className="pv-checkbox-row" style={{ opacity: disabled ? 0.45 : 1 }}>
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
            </section>
          )}

          {activeSection === 'memory' && (
            <section className="pv-panel">
              <div className="pv-panel-header">
                <h2 className="pv-section-title">Memory Revival</h2>
              </div>
              <div className="pv-panel-body">
                {seedDataset.memories.map((m) => (
                  <label key={m.id} className="pv-checkbox-row">
                    <input
                      type="checkbox"
                      checked={build.memoryIds.includes(m.id)}
                      onChange={() => toggleInList('memoryIds', m.id)}
                    />
                    <span>{m.name}</span>
                    {m.season && <em className="pv-metadata">{m.season}</em>}
                  </label>
                ))}
              </div>
            </section>
          )}

          {activeSection === 'vorax' && (
            <section className="pv-panel">
              <div className="pv-panel-header">
                <h2 className="pv-section-title">Vorax Gear</h2>
              </div>
              <div className="pv-panel-body" style={{ display: 'grid', gap: 12 }}>
                <p className="pv-metadata">
                  An extra limb slot worn in addition to normal gear. Affixes with no recognized
                  effect (the parser couldn't map their text to a modeled stat) are hidden from
                  these lists to keep them usable — the raw tier/weight data is still there for the
                  crafting sim.
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
                      <div key={limb} className="pv-card" style={{ padding: 10 }}>
                        <div className="pv-field-label" style={{ marginBottom: 6, textTransform: 'capitalize' }}>
                          {limb}
                        </div>
                        <select
                          className="pv-select"
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
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                            {affixes.slice(0, 20).map((a) => {
                              const on = piece?.affixIds.includes(a.id) ?? false;
                              return (
                                <label
                                  key={a.id}
                                  className="pv-badge pv-badge-btn"
                                  style={on ? { color: 'var(--pv-accent)', borderColor: 'var(--pv-accent)' } : undefined}
                                >
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    className="pv-visually-hidden"
                                    onChange={() => {
                                      const current = piece ?? { limb, affixIds: [] };
                                      const affixIds = on
                                        ? current.affixIds.filter((x) => x !== a.id)
                                        : [...current.affixIds, a.id];
                                      setVoraxGear(limb, { ...current, affixIds });
                                    }}
                                  />
                                  {voraxAffixLabel(a)}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </section>
          )}

          {activeSection === 'share' && (
            <section className="pv-panel">
              <div className="pv-panel-header">
                <h2 className="pv-section-title">Share</h2>
              </div>
              <div className="pv-panel-body">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <button
                    type="button"
                    className="pv-btn"
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
                    <Copy size={14} />
                    {linkCopied ? 'Link copied!' : 'Copy share link'}
                  </button>
                  <button type="button" className="pv-btn" onClick={() => setShareCode(encodeBuild(build))}>
                    <Download size={14} />
                    Export code
                  </button>
                  <button
                    type="button"
                    className="pv-btn"
                    onClick={() => {
                      setImportError(null);
                      try {
                        loadBuild(decodeBuild(shareCode));
                      } catch {
                        setImportError('Could not decode that build code.');
                      }
                    }}
                  >
                    <Upload size={14} />
                    Import code
                  </button>
                </div>
                <textarea
                  className="pv-textarea"
                  style={{ minHeight: 120, fontFamily: 'var(--pv-font-mono)', fontSize: 'var(--pv-text-xs)' }}
                  value={shareCode}
                  placeholder="Export to generate a share code, or paste one here and Import."
                  onChange={(e) => setShareCode(e.target.value)}
                />
                {importError && (
                  <p className="pv-warning-item" style={{ marginTop: 8 }}>
                    {importError}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>
      }
    />
  );
}

function OverviewSection({
  build,
  hero,
  skill,
  report,
  onNavigate
}: {
  build: Build;
  hero: string | undefined;
  skill: string | undefined;
  report: ReturnType<typeof evaluateBuild> | { error: string };
  onNavigate: (section: PlannerSection) => void;
}) {
  const checklist: { label: string; done: boolean; section: PlannerSection }[] = [
    { label: `Hero selected (${hero ?? 'none'})`, done: Boolean(hero), section: 'hero' },
    { label: `Main skill selected (${skill ?? 'none'})`, done: Boolean(skill), section: 'skills' },
    { label: `Equipment: ${build.gear.length}/${GEAR_SLOTS.length} slots filled`, done: build.gear.length > 0, section: 'equipment' },
    { label: `Talents: ${build.talentIds.length} selected`, done: build.talentIds.length > 0, section: 'talents' },
    {
      label: `Pact spirits: ${build.pactSpiritIds.length}/${MAX_PACT_SPIRITS}`,
      done: build.pactSpiritIds.length > 0,
      section: 'pactSpirits'
    }
  ];

  const warningCount = 'error' in report ? 0 : report.warnings.length;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="pv-panel">
        <div className="pv-panel-header">
          <h2 className="pv-section-title">Build readiness</h2>
        </div>
        <div className="pv-panel-body">
          {checklist.map((item) => (
            <button
              key={item.section}
              type="button"
              className="pv-checklist-item"
              onClick={() => onNavigate(item.section)}
            >
              {item.done ? (
                <CheckCircle2 size={15} className="pv-checklist-icon-done" />
              ) : (
                <Circle size={15} className="pv-checklist-icon-pending" />
              )}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="pv-panel">
        <div className="pv-panel-header">
          <h2 className="pv-section-title">Status</h2>
        </div>
        <div className="pv-panel-body">
          {'error' in report ? (
            <p className="pv-metadata">Calculation error: {report.error}</p>
          ) : (
            <>
              <div className="pv-stat-row">
                <span className="pv-stat-row-label">DPS</span>
                <span className="pv-stat-row-value pv-tabular">{Math.round(report.damage.dps).toLocaleString()}</span>
              </div>
              <div className="pv-stat-row">
                <span className="pv-stat-row-label">Open warnings</span>
                <span className="pv-stat-row-value pv-tabular">{warningCount}</span>
              </div>
            </>
          )}
          <p className="pv-metadata" style={{ marginTop: 8 }}>
            Full live statistics stay visible in the right-hand panel while you work in any
            workspace.
          </p>
        </div>
      </section>
    </div>
  );
}
