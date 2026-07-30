import type { Build, GearPiece, GearSlot } from '@torchlight-companion/build-data';

/**
 * KNOWN SCHEMA LIMITATION, read before touching this file:
 *
 * `GearSlot` (packages/build-data/src/schema.ts) has exactly one `'ring'`
 * literal -- there is no `'ring1'`/`'ring2'` distinction at the type level.
 * The rebuild brief asked that dual rings not be silently added to the
 * schema without tests/migration. They weren't -- schema.ts is untouched.
 *
 * What *is* true, confirmed by reading collectModifiers (build-calc/src/
 * build.ts) and marginalGearAnalysis (build-calc/src/marginal.ts): both
 * iterate `build.gear` as a flat, unordered array and process every
 * GearPiece present, with no assumption that a slot value is unique within
 * it. A Build with two `{ slot: 'ring', ... }` entries already aggregates
 * both rings' modifiers correctly and already gets both considered
 * independently by the upgrade-suggestion analysis -- nothing there needed
 * to change.
 *
 * The only place "one ring" was ever actually enforced was the old
 * planner UI's own gearBySlot()/setGear() helpers, which used slot as a
 * unique key (.find() / filter-and-replace). That was a UI-layer choice,
 * not a calc-engine or schema constraint. This module replaces that
 * approach: every slot maps to a fixed number of *instances*, all 1 except
 * `ring`, which gets 2 -- addressed by (slot, instanceIndex) instead of
 * slot alone. Extending this further (e.g. if the schema ever grows a
 * real multi-ring concept) means editing SLOT_INSTANCES, not rethinking
 * the addressing scheme.
 */
export interface SlotInstance {
  slot: GearSlot;
  instanceIndex: number;
  label: string;
}

export const SLOT_INSTANCES: SlotInstance[] = [
  { slot: 'weapon', instanceIndex: 0, label: 'Weapon' },
  { slot: 'offhand', instanceIndex: 0, label: 'Offhand' },
  { slot: 'helmet', instanceIndex: 0, label: 'Helmet' },
  { slot: 'chest', instanceIndex: 0, label: 'Chest' },
  { slot: 'gloves', instanceIndex: 0, label: 'Gloves' },
  { slot: 'boots', instanceIndex: 0, label: 'Boots' },
  { slot: 'belt', instanceIndex: 0, label: 'Belt' },
  { slot: 'amulet', instanceIndex: 0, label: 'Amulet' },
  { slot: 'ring', instanceIndex: 0, label: 'Ring 1' },
  { slot: 'ring', instanceIndex: 1, label: 'Ring 2' }
];

/** The Nth (0-based) gear piece with this slot value, in array order. */
export function gearAt(build: Build, slot: GearSlot, instanceIndex: number): GearPiece | undefined {
  return build.gear.filter((g) => g.slot === slot)[instanceIndex];
}

/** Replaces (or, if `piece` is null, removes) the Nth piece with this slot
 * value, leaving every other slot -- and every other instance of the same
 * slot -- untouched. */
export function setGearAt(
  build: Build,
  slot: GearSlot,
  instanceIndex: number,
  piece: GearPiece | null
): Pick<Build, 'gear'> {
  const matches = build.gear.filter((g) => g.slot === slot);
  const others = build.gear.filter((g) => g.slot !== slot);
  const nextMatches = [...matches];
  if (piece) {
    nextMatches[instanceIndex] = piece;
  } else {
    nextMatches.splice(instanceIndex, 1);
  }
  return { gear: [...others, ...nextMatches.filter((g): g is GearPiece => Boolean(g))] };
}
