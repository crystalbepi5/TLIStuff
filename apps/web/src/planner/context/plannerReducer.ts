import type { Build } from '@torchlight-companion/build-data';

/** Session-local interaction history, not full versioning -- capped so it
 * can't grow unbounded across a long editing session. */
export const MAX_HISTORY = 80;

/** Edits sharing the same groupKey within this window collapse into a
 * single history entry (e.g. keystrokes while typing a build name), so
 * undo steps through meaningful actions rather than individual characters. */
const GROUP_DEBOUNCE_MS = 600;

export interface PlannerState {
  build: Build;
  past: Build[];
  future: Build[];
  lastGroupKey: string | null;
  lastEditAt: number;
}

export type BuildPatch = Partial<Build> | ((build: Build) => Partial<Build>);

export type PlannerAction =
  | { type: 'PATCH'; patch: BuildPatch; groupKey?: string; now?: number }
  | { type: 'LOAD_BUILD'; build: Build }
  | { type: 'UNDO' }
  | { type: 'REDO' };

export function createPlannerState(build: Build): PlannerState {
  return { build, past: [], future: [], lastGroupKey: null, lastEditAt: 0 };
}

function buildsEqual(a: Build, b: Build): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case 'PATCH': {
      const resolved = typeof action.patch === 'function' ? action.patch(state.build) : action.patch;
      const nextBuild = { ...state.build, ...resolved };
      if (buildsEqual(nextBuild, state.build)) return state; // no-op edits don't enter history

      const now = action.now ?? Date.now();
      const sameGroup =
        action.groupKey !== undefined &&
        action.groupKey === state.lastGroupKey &&
        now - state.lastEditAt < GROUP_DEBOUNCE_MS;

      if (sameGroup) {
        return { ...state, build: nextBuild, future: [], lastEditAt: now };
      }

      const past = [...state.past, state.build].slice(-MAX_HISTORY);
      return {
        build: nextBuild,
        past,
        future: [],
        lastGroupKey: action.groupKey ?? null,
        lastEditAt: now
      };
    }

    case 'LOAD_BUILD': {
      if (buildsEqual(action.build, state.build)) return state;
      return createPlannerState(action.build); // hard replace resets undo/redo lineage
    }

    case 'UNDO': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1]!;
      return {
        build: previous,
        past: state.past.slice(0, -1),
        future: [state.build, ...state.future],
        lastGroupKey: null,
        lastEditAt: 0
      };
    }

    case 'REDO': {
      if (state.future.length === 0) return state;
      const next = state.future[0]!;
      return {
        build: next,
        past: [...state.past, state.build],
        future: state.future.slice(1),
        lastGroupKey: null,
        lastEditAt: 0
      };
    }

    default:
      return state;
  }
}
