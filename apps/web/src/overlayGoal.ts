import type { Build } from '@torchlight-companion/build-data';

// A "goal" is the build you're currently working toward. The planner writes it;
// the overlay surfaces it in-game. Persisted in localStorage as the planner's
// own base64 share code (btoa(encodeURIComponent(JSON.stringify(build)))), so
// it survives reloads and matches the planner's export/import format.
//
// LIMITATION: localStorage is per-origin, so this links the planner and overlay
// only when they run in the same context (both in the browser, or both inside
// the Electron shell). Bridging the external browser and the Electron overlay
// is a later step — persist the goal through the local-agent instead.

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
    return JSON.parse(decodeURIComponent(atob(code))) as Build;
  } catch {
    return null;
  }
}
