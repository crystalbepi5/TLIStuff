import { useMemo, useState } from 'react';
import {
  seedDataset,
  indexDataset,
  type Build,
  type GearPiece,
  type GearSlot
} from '@torchlight-companion/build-data';
import { evaluateBuild, MAX_PACT_SPIRITS } from '@torchlight-companion/build-calc';

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

function defaultBuild(): Build {
  return {
    id: 'draft',
    name: 'New Build',
    heroId: seedDataset.heroes[0]?.id ?? '',
    activeSkillId: seedDataset.activeSkills[0]?.id ?? '',
    supportIds: [],
    gear: [],
    talentIds: [],
    pactSpiritIds: [],
    divinityIds: [],
    extraModifiers: []
  };
}

function encodeBuild(build: Build): string {
  return btoa(encodeURIComponent(JSON.stringify(build)));
}

/** Decode a share code, backfilling any fields older codes may lack. */
function decodeBuild(code: string): Build {
  const parsed = JSON.parse(decodeURIComponent(atob(code.trim()))) as Partial<Build>;
  return {
    ...defaultBuild(),
    ...parsed,
    gear: parsed.gear ?? [],
    supportIds: parsed.supportIds ?? [],
    talentIds: parsed.talentIds ?? [],
    pactSpiritIds: parsed.pactSpiritIds ?? [],
    divinityIds: parsed.divinityIds ?? [],
    extraModifiers: parsed.extraModifiers ?? []
  };
}

export function BuildPlanner() {
  const [build, setBuild] = useState<Build>(defaultBuild);
  const [shareCode, setShareCode] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const skill = index.activeSkill(build.activeSkillId);
  const supportSlots = skill?.supportSlots ?? 0;

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
    key: 'talentIds' | 'pactSpiritIds' | 'divinityIds',
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

  return (
    <div className="planner">
      <header className="planner-header">
        <h1>Build Planner</h1>
        <span className="planner-badge">{seedDataset.meta.source} data</span>
        <a className="planner-nav-link" href="#overlay">
          ← overlay
        </a>
      </header>

      <p className="planner-disclaimer">
        Data is drawn from the SS13 <strong>“Afterlight” patch notes</strong> and mapped onto a
        simplified model — effects that rely on unmodelled mechanics (Terra Charge, Spell Burst,
        conditionals) are approximated or dropped, and the damage <strong>formula</strong> itself is
        still an estimate. Treat DPS as a relative indicator, not in-game truth.
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
          </h3>
          <div className="checkbox-list">
            {seedDataset.supportSkills.map((sup) => {
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
          </div>
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
          <h2>Progression</h2>

          <h3>Talents</h3>
          <div className="checkbox-list">
            {seedDataset.talents
              .filter((t) => t.heroId === 'any' || t.heroId === build.heroId)
              .map((t) => (
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
          </div>

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

          <h3>Nether King's Divinity</h3>
          <div className="checkbox-list">
            {seedDataset.divinities.map((d) => (
              <label key={d.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={build.divinityIds.includes(d.id)}
                  onChange={() => toggleInList('divinityIds', d.id)}
                />
                <span>{d.name}</span>
                {d.tier && <em className="req-tags">{d.tier}</em>}
              </label>
            ))}
          </div>
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
