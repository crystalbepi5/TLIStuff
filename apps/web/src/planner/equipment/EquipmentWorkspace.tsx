import { useState } from 'react';
import type { Build, GearPiece } from '@torchlight-companion/build-data';
import type { BuildPatch } from '../context/plannerReducer';
import { EquipmentSlotCard } from './EquipmentSlotCard';
import { ItemBrowser } from './ItemBrowser';
import { AffixInspector } from './AffixInspector';
import { SLOT_INSTANCES, gearAt, setGearAt, type SlotInstance } from './gearSlots';
import { index } from '../buildUtils';

interface EquipmentWorkspaceProps {
  build: Build;
  patchBuild: (patch: BuildPatch, opts?: { groupKey?: string }) => void;
}

/** Spatial layout, not a flat list -- roughly mirrors where each slot sits
 * on a character (helmet up top, weapon/offhand flanking the chest,
 * gloves/amulet flanking the belt, boots and both rings along the bottom).
 * No character artwork exists in the dataset, so this stays an abstract
 * silhouette built from CSS grid areas rather than an image. */
const GRID_AREA: Record<string, string> = {
  'weapon:0': 'weapon',
  'offhand:0': 'offhand',
  'helmet:0': 'helmet',
  'chest:0': 'chest',
  'gloves:0': 'gloves',
  'boots:0': 'boots',
  'belt:0': 'belt',
  'amulet:0': 'amulet',
  'ring:0': 'ring1',
  'ring:1': 'ring2'
};

function key(slotInstance: SlotInstance): string {
  return `${slotInstance.slot}:${slotInstance.instanceIndex}`;
}

export function EquipmentWorkspace({ build, patchBuild }: EquipmentWorkspaceProps) {
  const [browserTarget, setBrowserTarget] = useState<SlotInstance | null>(null);
  const [affixTarget, setAffixTarget] = useState<SlotInstance | null>(null);

  function assign(slotInstance: SlotInstance, baseId: string) {
    patchBuild((prev) => {
      const current = gearAt(prev, slotInstance.slot, slotInstance.instanceIndex);
      const piece: GearPiece = { slot: slotInstance.slot, baseId, affixIds: current?.affixIds ?? [] };
      return setGearAt(prev, slotInstance.slot, slotInstance.instanceIndex, piece);
    });
    setBrowserTarget(null);
  }

  function remove(slotInstance: SlotInstance) {
    patchBuild((prev) => setGearAt(prev, slotInstance.slot, slotInstance.instanceIndex, null));
    setBrowserTarget(null);
    setAffixTarget(null);
  }

  function changeAffixes(slotInstance: SlotInstance, piece: GearPiece) {
    patchBuild((prev) => setGearAt(prev, slotInstance.slot, slotInstance.instanceIndex, piece));
  }

  const filledCount = build.gear.length;

  return (
    <section className="pv-panel">
      <div className="pv-panel-header">
        <h2 className="pv-section-title">Equipment</h2>
        <span className="pv-badge">{filledCount}/{SLOT_INSTANCES.length} slots filled</span>
      </div>
      <div className="pv-panel-body">
        <p className="pv-metadata" style={{ marginBottom: 14 }}>
          Two ring slots — the underlying data only has one <code className="pv-code">ring</code> gear
          type, but nothing in the calculator treats a slot as unique, so both rings' modifiers add up
          normally. See the code comment in <code className="pv-code">equipment/gearSlots.ts</code> if
          you're touching this.
        </p>
        <div className="pv-equip-canvas">
          {SLOT_INSTANCES.map((slotInstance) => (
            <EquipmentSlotCard
              key={key(slotInstance)}
              slotInstance={slotInstance}
              piece={gearAt(build, slotInstance.slot, slotInstance.instanceIndex)}
              gridArea={GRID_AREA[key(slotInstance)] ?? slotInstance.slot}
              onOpenBrowser={() => setBrowserTarget(slotInstance)}
              onOpenAffixes={() => setAffixTarget(slotInstance)}
              onRemove={() => remove(slotInstance)}
            />
          ))}
        </div>
      </div>

      {browserTarget && (
        <ItemBrowser
          build={build}
          slotInstance={browserTarget}
          onClose={() => setBrowserTarget(null)}
          onAssign={(baseId) => assign(browserTarget, baseId)}
          onRemove={() => remove(browserTarget)}
        />
      )}

      {affixTarget &&
        (() => {
          const piece = gearAt(build, affixTarget.slot, affixTarget.instanceIndex);
          const base = piece ? index.gearBase(piece.baseId) : undefined;
          if (!piece || !base) return null;
          return (
            <AffixInspector
              piece={piece}
              slotInstance={affixTarget}
              baseName={base.name}
              onClose={() => setAffixTarget(null)}
              onChange={(next) => changeAffixes(affixTarget, next)}
            />
          );
        })()}
    </section>
  );
}
