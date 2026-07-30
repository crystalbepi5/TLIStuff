import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { seedDataset, type ActiveSkill, type Build } from '@torchlight-companion/build-data';
import { evaluateBuild } from '@torchlight-companion/build-calc';
import { index, LIST_LIMIT } from '../buildUtils';
import { SkillIcon } from './SkillIcon';

interface SupportBrowserProps {
  build: Build;
  skill: ActiveSkill;
  slotIndex: number;
  onClose: () => void;
  onAssign: (supportId: string) => void;
  onRemove: () => void;
}

interface Preview {
  dpsDelta: number | null; // null when the DPS report itself errored
  ignoredReason: string | null; // the calc engine's own warning text, if this support would contribute nothing
}

/** Runs the real calculator with this one support swapped into the target
 * slot and diffs the result against the current build -- both the DPS
 * delta and the "why this won't do anything" explanation come straight
 * from evaluateBuild's own warnings, never a separately-maintained guess
 * at the compatibility rules. */
function previewSupport(build: Build, skill: ActiveSkill, supportId: string, slotIndex: number, baselineDps: number): Preview {
  const nextSupportIds = [...build.supportIds];
  nextSupportIds[slotIndex] = supportId;
  const candidate: Build = { ...build, supportIds: nextSupportIds.slice(0, skill.supportSlots) };
  try {
    const report = evaluateBuild(candidate, index);
    const support = index.supportSkill(supportId);
    const ignored = support
      ? report.warnings.find((w) => w.includes(`support '${support.name}'`) && w.includes('ignored'))
      : undefined;
    return { dpsDelta: report.damage.dps - baselineDps, ignoredReason: ignored ?? null };
  } catch {
    return { dpsDelta: null, ignoredReason: null };
  }
}

export function SupportBrowser({ build, skill, slotIndex, onClose, onAssign, onRemove }: SupportBrowserProps) {
  const [search, setSearch] = useState('');
  const [previews, setPreviews] = useState<Map<string, Preview>>(new Map());

  const baselineDps = useMemo(() => {
    try {
      return evaluateBuild(build, index).damage.dps;
    } catch {
      return 0;
    }
  }, [build]);

  const currentId = build.supportIds[slotIndex];

  const q = search.trim().toLowerCase();
  const matches = seedDataset.supportSkills.filter((s) => q === '' || s.name.toLowerCase().includes(q));
  const shown = matches.slice(0, LIST_LIMIT);
  const hidden = Math.max(0, matches.length - LIST_LIMIT);

  function ensurePreview(supportId: string) {
    if (previews.has(supportId)) return;
    const preview = previewSupport(build, skill, supportId, slotIndex, baselineDps);
    setPreviews((prev) => new Map(prev).set(supportId, preview));
  }

  return (
    <>
      <div className="pv-overlay-scrim" onClick={onClose} />
      <div className="pv-dialog pv-dialog-side" role="dialog" aria-labelledby="support-browser-title">
        <div className="pv-dialog-header">
          <h3 id="support-browser-title" className="pv-section-title" style={{ margin: 0 }}>
            Support — slot {slotIndex + 1}
          </h3>
          <button type="button" className="pv-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="pv-dialog-body">
          <div className="pv-search" style={{ marginBottom: 10 }}>
            <input
              type="search"
              placeholder={`Search ${seedDataset.supportSkills.length} supports…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          {currentId && (
            <button type="button" className="pv-btn pv-btn-sm pv-btn-danger" style={{ marginBottom: 10 }} onClick={onRemove}>
              Remove current support
            </button>
          )}

          <div style={{ display: 'grid', gap: 4 }}>
            {shown.map((s) => {
              const selected = s.id === currentId;
              const preview = previews.get(s.id);
              const incompatible = Boolean(preview?.ignoredReason);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`pv-browser-row ${selected ? 'is-selected' : ''} ${incompatible ? 'is-incompatible' : ''}`}
                  onMouseEnter={() => ensurePreview(s.id)}
                  onFocus={() => ensurePreview(s.id)}
                  onClick={() => onAssign(s.id)}
                >
                  <SkillIcon icon={s.icon} name={s.name} size={28} />
                  <span className="pv-browser-row-main">
                    <span className="pv-browser-row-name">{s.name}</span>
                    {s.requiresTags.length > 0 && (
                      <div className="pv-metadata">needs {s.requiresTags.join('/')}</div>
                    )}
                    {preview?.ignoredReason && <div className="pv-browser-row-reason">{preview.ignoredReason}</div>}
                  </span>
                  {preview && preview.dpsDelta !== null && (
                    <span
                      className="pv-browser-row-delta pv-tabular"
                      style={{ color: preview.dpsDelta >= 0 ? 'var(--pv-success)' : 'var(--pv-danger)' }}
                    >
                      {preview.dpsDelta >= 0 ? '+' : ''}
                      {Math.round(preview.dpsDelta).toLocaleString()} dps
                    </span>
                  )}
                </button>
              );
            })}
            {hidden > 0 && <p className="pv-metadata">+{hidden} more — refine search</p>}
            {shown.length === 0 && <p className="pv-metadata">No matches.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
