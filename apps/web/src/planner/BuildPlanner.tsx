import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Copy, Download, Upload } from 'lucide-react';
import { seedDataset, type Build, type VoraxGearPiece } from '@torchlight-companion/build-data';
import {
  evaluateBuild,
  marginalGearAnalysis,
  MAX_PACT_SPIRITS,
  type AffixSwapSuggestion
} from '@torchlight-companion/build-calc';
import { ProgressionTreeCanvas } from './progression/ProgressionTreeCanvas';
import { PlannerShell } from './PlannerShell';
import { PlannerHeader } from './PlannerHeader';
import { PlannerNavigation } from './PlannerNavigation';
import { PlannerStatsRail } from './PlannerStatsRail';
import type { PlannerSection } from './plannerSections';
import { PlannerProvider, usePlanner } from './context/PlannerContext';
import {
  index,
  decodeBuild,
  describeModifiers,
  encodeBuild,
  filterList,
  shareUrl,
  voraxAffixLabel,
  voraxLegendaryLabel
} from './buildUtils';
import { HeroWorkspace } from './hero/HeroWorkspace';
import { SkillsWorkspace } from './skills/SkillsWorkspace';
import { EquipmentWorkspace } from './equipment/EquipmentWorkspace';
import { SLOT_INSTANCES } from './equipment/gearSlots';
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
  const [talentSearch, setTalentSearch] = useState('');

  const [progressionCategory, setProgressionCategory] = useState<'talentTrees' | 'voidCharts'>('talentTrees');
  const [progressionTreeId, setProgressionTreeId] = useState<string>('');

  const hero = index.hero(build.heroId);
  const skill = index.activeSkill(build.activeSkillId);

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

  function toggleInList(key: 'talentIds' | 'pactSpiritIds' | 'memoryIds', id: string, cap?: number) {
    patchBuild((prev) => {
      const list = prev[key];
      if (list.includes(id)) return { [key]: list.filter((x) => x !== id) };
      if (cap !== undefined && list.length >= cap) return {};
      return { [key]: [...list, id] };
    });
  }

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

          {activeSection === 'hero' && <HeroWorkspace build={build} patchBuild={patchBuild} />}

          {activeSection === 'skills' && <SkillsWorkspace build={build} patchBuild={patchBuild} />}

          {activeSection === 'equipment' && <EquipmentWorkspace build={build} patchBuild={patchBuild} />}

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
                        <label key={t.id} className="pv-checkbox-row" style={{ alignItems: 'flex-start' }}>
                          <input
                            type="checkbox"
                            checked={build.talentIds.includes(t.id)}
                            onChange={() => toggleInList('talentIds', t.id)}
                            style={{ marginTop: 3 }}
                          />
                          <span>
                            {t.name}
                            {t.heroId === 'any' && (
                              <em className="pv-metadata" style={{ marginLeft: 6 }}>
                                shared
                              </em>
                            )}
                            <div className="pv-metadata">{describeModifiers(t.modifiers)}</div>
                          </span>
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
                <div className="pv-segmented" style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className={progressionCategory === 'talentTrees' ? 'is-active' : ''}
                    onClick={() => {
                      setProgressionCategory('talentTrees');
                      setProgressionTreeId('');
                    }}
                  >
                    Talent Trees ({(seedDataset.talentTrees ?? []).length})
                  </button>
                  <button
                    type="button"
                    className={progressionCategory === 'voidCharts' ? 'is-active' : ''}
                    onClick={() => {
                      setProgressionCategory('voidCharts');
                      setProgressionTreeId('');
                    }}
                  >
                    Void Chart ({(seedDataset.voidCharts ?? []).length})
                  </button>
                </div>
                {(() => {
                  const trees = seedDataset[progressionCategory] ?? [];
                  const tree = trees.find((t) => t.id === progressionTreeId) ?? trees[0];
                  const selectedIds = new Set(
                    progressionCategory === 'talentTrees' ? build.talentTreeNodeIds : build.voidChartNodeIds
                  );
                  return (
                    <>
                      {trees.length > 1 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                          {trees.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              className="pv-badge pv-badge-btn"
                              style={
                                t.id === (tree?.id ?? '')
                                  ? { color: 'var(--pv-accent)', borderColor: 'var(--pv-accent)' }
                                  : undefined
                              }
                              onClick={() => setProgressionTreeId(t.id)}
                            >
                              {t.name} ({t.nodes.length})
                            </button>
                          ))}
                        </div>
                      )}
                      {tree && (
                        <ProgressionTreeCanvas
                          tree={tree}
                          selectedIds={selectedIds}
                          onToggle={(nodeId) => toggleProgressionNode(progressionCategory, nodeId)}
                        />
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
    { label: `Equipment: ${build.gear.length}/${SLOT_INSTANCES.length} slots filled`, done: build.gear.length > 0, section: 'equipment' },
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
