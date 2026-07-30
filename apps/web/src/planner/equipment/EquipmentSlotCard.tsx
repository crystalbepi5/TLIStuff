import { Plus, SlidersHorizontal, X } from 'lucide-react';
import type { GearPiece } from '@torchlight-companion/build-data';
import { index } from '../buildUtils';
import { ItemIcon } from './ItemIcon';
import type { SlotInstance } from './gearSlots';

interface EquipmentSlotCardProps {
  slotInstance: SlotInstance;
  piece: GearPiece | undefined;
  gridArea: string;
  onOpenBrowser: () => void;
  onOpenAffixes: () => void;
  onRemove: () => void;
}

/** One cell of the spatial equipment canvas (see EquipmentWorkspace's
 * paperdoll-shaped grid). Empty slots are a single "add item" affordance;
 * filled slots show the base's real art, name, and affix count, with
 * separate controls to swap the base or edit its affixes -- the affix
 * editor is a dedicated inspector (AffixInspector) rather than every affix
 * living under every item at once. */
export function EquipmentSlotCard({
  slotInstance,
  piece,
  gridArea,
  onOpenBrowser,
  onOpenAffixes,
  onRemove
}: EquipmentSlotCardProps) {
  const base = piece ? index.gearBase(piece.baseId) : undefined;

  return (
    <div className="pv-equip-slot" style={{ gridArea }}>
      <div className="pv-equip-slot-label">{slotInstance.label}</div>
      {piece && base ? (
        <div className="pv-equip-slot-card is-filled">
          <button type="button" className="pv-equip-slot-main" onClick={onOpenBrowser}>
            <ItemIcon icon={base.icon} size={36} />
            <span className="pv-equip-slot-name">{base.name}</span>
          </button>
          <div className="pv-equip-slot-actions">
            <button type="button" className="pv-icon-btn" onClick={onOpenAffixes} aria-label={`Edit ${base.name} affixes`}>
              <SlidersHorizontal size={13} />
              <span className="pv-badge" style={{ marginLeft: 4 }}>
                {piece.affixIds.length}
              </span>
            </button>
            <button type="button" className="pv-icon-btn" onClick={onRemove} aria-label={`Remove ${base.name}`}>
              <X size={13} />
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="pv-equip-slot-card pv-equip-slot-empty" onClick={onOpenBrowser}>
          <Plus size={18} />
          <span>Add item</span>
        </button>
      )}
    </div>
  );
}
