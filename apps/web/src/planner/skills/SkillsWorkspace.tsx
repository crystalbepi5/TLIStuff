import { useState } from 'react';
import { Plus, X, PenLine } from 'lucide-react';
import { seedDataset, type Build } from '@torchlight-companion/build-data';
import { totalManaCost } from '@torchlight-companion/build-calc';
import type { BuildPatch } from '../context/plannerReducer';
import { index, LIST_LIMIT } from '../buildUtils';
import { SkillIcon } from './SkillIcon';
import { SupportBrowser } from './SupportBrowser';

interface SkillsWorkspaceProps {
  build: Build;
  patchBuild: (patch: BuildPatch, opts?: { groupKey?: string }) => void;
}

export function SkillsWorkspace({ build, patchBuild }: SkillsWorkspaceProps) {
  const [skillBrowserOpen, setSkillBrowserOpen] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const [openSlot, setOpenSlot] = useState<number | null>(null);

  const skill = index.activeSkill(build.activeSkillId);
  const supportSlots = skill?.supportSlots ?? 0;
  const manaCost = skill
    ? totalManaCost(
        skill,
        build.supportIds.map((id) => index.supportSkill(id))
      )
    : 0;

  function selectSkill(activeSkillId: string) {
    patchBuild({ activeSkillId, supportIds: [] });
    setSkillBrowserOpen(false);
    setSkillSearch('');
  }

  function assignSupport(slotIndex: number, supportId: string) {
    patchBuild((prev) => {
      const next = [...prev.supportIds];
      next[slotIndex] = supportId;
      return { supportIds: next.slice(0, supportSlots) };
    });
    setOpenSlot(null);
  }

  function removeSupport(slotIndex: number) {
    patchBuild((prev) => ({ supportIds: prev.supportIds.filter((_, i) => i !== slotIndex) }));
    setOpenSlot(null);
  }

  const q = skillSearch.trim().toLowerCase();
  const skillMatches = seedDataset.activeSkills.filter((s) => q === '' || s.name.toLowerCase().includes(q));
  const shownSkills = skillMatches.slice(0, LIST_LIMIT);
  const hiddenSkills = Math.max(0, skillMatches.length - LIST_LIMIT);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section className="pv-panel">
        <div className="pv-skill-hero-card">
          <SkillIcon icon={skill?.icon} name={skill?.name ?? ''} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pv-skill-hero-card-name">{skill?.name ?? 'No skill selected'}</div>
            <div className="pv-skill-hero-card-tags">
              {skill?.tags.map((t) => (
                <span key={t} className="pv-badge">
                  {t}
                </span>
              ))}
              <span className="pv-badge pv-badge-accent">Mana {manaCost.toFixed(1)}</span>
            </div>
          </div>
          <button type="button" className="pv-btn pv-btn-sm" onClick={() => setSkillBrowserOpen(true)}>
            <PenLine size={13} />
            Change skill
          </button>
        </div>
      </section>

      <section className="pv-panel">
        <div className="pv-panel-header">
          <h2 className="pv-section-title">Supports</h2>
          <span className="pv-badge">
            {build.supportIds.length}/{supportSlots}
          </span>
        </div>
        <div className="pv-panel-body">
          {supportSlots === 0 ? (
            <p className="pv-metadata">This skill has no support slots.</p>
          ) : (
            <div className="pv-support-slots">
              {Array.from({ length: supportSlots }, (_, i) => {
                const supportId = build.supportIds[i];
                const support = supportId ? index.supportSkill(supportId) : undefined;
                return (
                  <div
                    key={i}
                    className={`pv-support-slot ${support ? 'is-filled' : ''}`}
                    onClick={() => setOpenSlot(i)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpenSlot(i);
                      }
                    }}
                    aria-label={support ? `Slot ${i + 1}: ${support.name}, click to change` : `Slot ${i + 1}: empty, click to add a support`}
                  >
                    {support ? (
                      <>
                        <SkillIcon icon={support.icon} name={support.name} size={28} />
                        <span className="pv-support-slot-name">{support.name}</span>
                        <button
                          type="button"
                          className="pv-icon-btn pv-support-slot-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSupport(i);
                          }}
                          aria-label={`Remove ${support.name}`}
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <>
                        <Plus size={18} />
                        <span className="pv-support-slot-name">Add support</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {openSlot !== null && skill && (
        <SupportBrowser
          build={build}
          skill={skill}
          slotIndex={openSlot}
          onClose={() => setOpenSlot(null)}
          onAssign={(supportId) => assignSupport(openSlot, supportId)}
          onRemove={() => removeSupport(openSlot)}
        />
      )}

      {skillBrowserOpen && (
        <>
          <div className="pv-overlay-scrim" onClick={() => setSkillBrowserOpen(false)} />
          <div className="pv-dialog pv-dialog-side" role="dialog" aria-labelledby="skill-browser-title">
            <div className="pv-dialog-header">
              <h3 id="skill-browser-title" className="pv-section-title" style={{ margin: 0 }}>
                Main skill
              </h3>
              <button type="button" className="pv-icon-btn" onClick={() => setSkillBrowserOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="pv-dialog-body">
              <div className="pv-search" style={{ marginBottom: 10 }}>
                <input
                  type="search"
                  placeholder={`Search ${seedDataset.activeSkills.length} skills…`}
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <p className="pv-metadata" style={{ marginBottom: 8 }}>
                Changing your main skill clears socketed supports, since slot count and tag
                compatibility are skill-specific.
              </p>
              <div style={{ display: 'grid', gap: 4 }}>
                {shownSkills.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`pv-browser-row ${s.id === build.activeSkillId ? 'is-selected' : ''}`}
                    onClick={() => selectSkill(s.id)}
                  >
                    <SkillIcon icon={s.icon} name={s.name} size={28} />
                    <span className="pv-browser-row-main">
                      <span className="pv-browser-row-name">{s.name}</span>
                      <div className="pv-metadata">
                        {s.tags.join(', ')} · {s.supportSlots} support slots
                      </div>
                    </span>
                  </button>
                ))}
                {hiddenSkills > 0 && <p className="pv-metadata">+{hiddenSkills} more — refine search</p>}
                {shownSkills.length === 0 && <p className="pv-metadata">No matches.</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
