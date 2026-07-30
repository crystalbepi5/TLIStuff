import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { seedDataset, type Build, type GearSlot } from '@torchlight-companion/build-data';
import { evaluateBuild } from '@torchlight-companion/build-calc';
import { index, LIST_LIMIT } from '../buildUtils';
import { ItemIcon } from './ItemIcon';
import { gearAt, setGearAt, type SlotInstance } from './gearSlots';

interface ItemBrowserProps {
  build: Build;
  slotInstance: SlotInstance;
  onClose: () => void;
  onAssign: (baseId: string) => void;
  onRemove: () => void;
}

interface Preview {
  dpsDelta: number;
  lifeDelta: number;
}

/** Swaps this one base into the target slot instance (keeping whatever
 * affixes were already equipped there -- affixes are validated against the
 * slot, not the specific base, so they carry over cleanly) and diffs the
 * result against the current build. Deliberately surfaces both an offense
 * and a defense number, framed as "Projected change" rather than a verdict
 * -- a DPS gain that comes with a life loss isn't automatically "better". */
function previewBase(
  build: Build,
  slot: GearSlot,
  instanceIndex: number,
  baseId: string,
  baseline: { dps: number; life: number }
): Preview {
  const current = gearAt(build, slot, instanceIndex);
  const patch = setGearAt(build, slot, instanceIndex, { slot, baseId, affixIds: current?.affixIds ?? [] });
  const candidate: Build = { ...build, ...patch };
  try {
    const report = evaluateBuild(candidate, index);
    return { dpsDelta: report.damage.dps - baseline.dps, lifeDelta: report.defense.life - baseline.life };
  } catch {
    return { dpsDelta: 0, lifeDelta: 0 };
  }
}

export function ItemBrowser({ build, slotInstance, onClose, onAssign, onRemove }: ItemBrowserProps) {
  const [search, setSearch] = useState('');
  const [previews, setPreviews] = useState<Map<string, Preview>>(new Map());

  const { slot, instanceIndex, label } = slotInstance;
  const current = gearAt(build, slot, instanceIndex);

  const baseline = useMemo(() => {
    try {
      const report = evaluateBuild(build, index);
      return { dps: report.damage.dps, life: report.defense.life };
    } catch {
      return { dps: 0, life: 0 };
    }
  }, [build]);

  const q = search.trim().toLowerCase();
  const bases = seedDataset.gearBases.filter((b) => b.slot === slot);
  const matches = bases.filter((b) => q === '' || b.name.toLowerCase().includes(q));
  const shown = matches.slice(0, LIST_LIMIT);
  const hidden = Math.max(0, matches.length - LIST_LIMIT);

  function ensurePreview(baseId: string) {
    if (previews.has(baseId)) return;
    setPreviews((prev) => new Map(prev).set(baseId, previewBase(build, slot, instanceIndex, baseId, baseline)));
  }

  return (
    <>
      <div className="pv-overlay-scrim" onClick={onClose} />
      <div className="pv-dialog pv-dialog-side" role="dialog" aria-labelledby="item-browser-title">
        <div className="pv-dialog-header">
          <h3 id="item-browser-title" className="pv-section-title" style={{ margin: 0 }}>
            {label}
          </h3>
          <button type="button" className="pv-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="pv-dialog-body">
          <div className="pv-search" style={{ marginBottom: 10 }}>
            <input
              type="search"
              placeholder={`Search ${bases.length} ${label.toLowerCase()} bases…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          {current && (
            <button type="button" className="pv-btn pv-btn-sm pv-btn-danger" style={{ marginBottom: 10 }} onClick={onRemove}>
              Remove item
            </button>
          )}

          <p className="pv-metadata" style={{ marginBottom: 8 }}>
            Projected change vs. your current build, hover to preview. DPS and Life are shown
            together on purpose — a gain in one can come with a loss in the other.
          </p>

          <div style={{ display: 'grid', gap: 4 }}>
            {shown.map((b) => {
              const selected = b.id === current?.baseId;
              const preview = previews.get(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`pv-browser-row ${selected ? 'is-selected' : ''}`}
                  onMouseEnter={() => ensurePreview(b.id)}
                  onFocus={() => ensurePreview(b.id)}
                  onClick={() => onAssign(b.id)}
                >
                  <ItemIcon icon={b.icon} size={28} />
                  <span className="pv-browser-row-main">
                    <span className="pv-browser-row-name">{b.name}</span>
                  </span>
                  {preview && (
                    <span style={{ display: 'grid', justifyItems: 'end', gap: 2 }}>
                      <span
                        className="pv-browser-row-delta pv-tabular"
                        style={{ color: preview.dpsDelta >= 0 ? 'var(--pv-success)' : 'var(--pv-danger)' }}
                      >
                        {preview.dpsDelta >= 0 ? '+' : ''}
                        {Math.round(preview.dpsDelta).toLocaleString()} dps
                      </span>
                      {preview.lifeDelta !== 0 && (
                        <span
                          className="pv-browser-row-delta pv-tabular"
                          style={{ color: preview.lifeDelta >= 0 ? 'var(--pv-success)' : 'var(--pv-danger)' }}
                        >
                          {preview.lifeDelta >= 0 ? '+' : ''}
                          {Math.round(preview.lifeDelta).toLocaleString()} life
                        </span>
                      )}
                    </span>
                  )}
                </button>
              );
            })}
            {hidden > 0 && <p className="pv-metadata">+{hidden} more — refine search</p>}
            {shown.length === 0 && <p className="pv-metadata">No {label.toLowerCase()} bases in the dataset.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
