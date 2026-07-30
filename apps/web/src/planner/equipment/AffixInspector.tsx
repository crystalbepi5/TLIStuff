import { useState } from 'react';
import { X } from 'lucide-react';
import { seedDataset, type Build, type GearPiece } from '@torchlight-companion/build-data';
import { modifiersForSlot } from '@torchlight-companion/build-calc';
import { describeModifiers } from '../buildUtils';
import type { SlotInstance } from './gearSlots';

interface AffixInspectorProps {
  piece: GearPiece;
  slotInstance: SlotInstance;
  baseName: string;
  onClose: () => void;
  onChange: (piece: GearPiece) => void;
}

/** Dedicated affix editor for one equipped piece -- replaces the old flat
 * "every affix as a checkbox chip under every item" layout with a
 * searchable, focused inspector, consistent with the support/talent
 * browsers elsewhere in the planner. */
export function AffixInspector({ piece, slotInstance, baseName, onClose, onChange }: AffixInspectorProps) {
  const [search, setSearch] = useState('');
  const { slot, label } = slotInstance;

  const q = search.trim().toLowerCase();
  const affixes = seedDataset.affixes.filter(
    (a) => a.slots.includes(slot) && (q === '' || a.name.toLowerCase().includes(q))
  );

  function toggle(affixId: string) {
    const on = piece.affixIds.includes(affixId);
    onChange({
      ...piece,
      affixIds: on ? piece.affixIds.filter((id) => id !== affixId) : [...piece.affixIds, affixId]
    });
  }

  return (
    <>
      <div className="pv-overlay-scrim" onClick={onClose} />
      <div className="pv-dialog pv-dialog-side" role="dialog" aria-labelledby="affix-inspector-title">
        <div className="pv-dialog-header">
          <h3 id="affix-inspector-title" className="pv-section-title" style={{ margin: 0 }}>
            {label} affixes
          </h3>
          <button type="button" className="pv-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="pv-dialog-body">
          <p className="pv-metadata" style={{ marginBottom: 10 }}>
            {baseName} · {piece.affixIds.length} affix{piece.affixIds.length === 1 ? '' : 'es'} equipped
          </p>
          <div className="pv-search" style={{ marginBottom: 10 }}>
            <input
              type="search"
              placeholder={`Search ${affixes.length} affixes…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div style={{ display: 'grid', gap: 4 }}>
            {affixes.map((a) => {
              const on = piece.affixIds.includes(a.id);
              const modifiers = modifiersForSlot(a, slot);
              return (
                <label key={a.id} className={`pv-browser-row ${on ? 'is-selected' : ''}`} style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(a.id)} className="pv-visually-hidden" />
                  <span className="pv-browser-row-main">
                    <span className="pv-browser-row-name">
                      {a.name} <span className="pv-metadata">({a.kind})</span>
                    </span>
                    <div className="pv-metadata">{describeModifiers(modifiers)}</div>
                  </span>
                </label>
              );
            })}
            {affixes.length === 0 && <p className="pv-metadata">No affixes match "{search}" for this slot.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
