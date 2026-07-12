import { decodeShareCode, type Build } from '@torchlight-companion/build-data';

// A "goal" is the build you're currently working toward. The planner writes it;
// the overlay surfaces it in-game. Persisted in localStorage as a native share
// code, so it survives reloads.
//
// LIMITATION: localStorage is per-origin, so this links the planner and overlay
// only when they run in the same context (both in the browser, or both inside
// the Electron shell). Making the goal shared across the external browser and
// the Electron overlay is the next step — persist it through the local-agent
// (a /goal endpoint + SSE) instead of localStorage.

export const OVERLAY_GOAL_KEY = 'tc:overlay-goal';

export function setOverlayGoal(shareCode: string): void {
  localStorage.setItem(OVERLAY_GOAL_KEY, shareCode);
  // storage events don't fire in the tab that made the change; nudge listeners.
  window.dispatchEvent(new StorageEvent('storage', { key: OVERLAY_GOAL_KEY }));
}

export function clearOverlayGoal(): void {
  localStorage.removeItem(OVERLAY_GOAL_KEY);
  window.dispatchEvent(new StorageEvent('storage', { key: OVERLAY_GOAL_KEY }));
}

export function getOverlayGoal(): Build | null {
  const code = localStorage.getItem(OVERLAY_GOAL_KEY);
  if (!code) return null;
  try {
    return decodeShareCode(code);
  } catch {
    return null;
  }
}
