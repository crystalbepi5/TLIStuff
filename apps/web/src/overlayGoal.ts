import type { Build } from '@torchlight-companion/build-data';
import { fetchGoalCode, putGoalCode, subscribeToGoal } from './api';

// A "goal" is the build you're currently working toward. The planner writes it;
// the overlay surfaces it in-game.
//
// The goal is persisted on the LOCAL-AGENT (a /goal endpoint + SSE), so it
// bridges the planner and overlay even when they run in different
// processes/origins (an external browser vs. the Electron overlay) — the case
// plain localStorage can't cover. localStorage is kept as a synchronous cache
// for instant first paint and as an offline fallback when the agent is down.

export const OVERLAY_GOAL_KEY = 'tc:overlay-goal';

function decode(code: string | null): Build | null {
  if (!code) return null;
  try {
    return JSON.parse(decodeURIComponent(atob(code))) as Build;
  } catch {
    return null;
  }
}

/** Set the goal: cache locally (instant, same-origin) and persist on the agent. */
export function setOverlayGoal(shareCode: string): void {
  localStorage.setItem(OVERLAY_GOAL_KEY, shareCode);
  window.dispatchEvent(new StorageEvent('storage', { key: OVERLAY_GOAL_KEY }));
  void putGoalCode(shareCode).catch(() => {
    /* agent offline — localStorage cache still bridges same-origin windows */
  });
}

export function clearOverlayGoal(): void {
  localStorage.removeItem(OVERLAY_GOAL_KEY);
  window.dispatchEvent(new StorageEvent('storage', { key: OVERLAY_GOAL_KEY }));
  void putGoalCode(null).catch(() => {});
}

/** Synchronous read of the cached goal — for the overlay's first render. */
export function getOverlayGoal(): Build | null {
  return decode(localStorage.getItem(OVERLAY_GOAL_KEY));
}

/** Authoritative read from the agent, falling back to the local cache. */
export async function fetchOverlayGoal(): Promise<Build | null> {
  try {
    return decode(await fetchGoalCode());
  } catch {
    return getOverlayGoal();
  }
}

/**
 * Watch for goal changes from either source: the agent's SSE stream (covers the
 * cross-process case) and same-origin `storage` events (covers the offline /
 * same-browser case). Returns an unsubscribe.
 */
export function subscribeOverlayGoal(onChange: (goal: Build | null) => void): () => void {
  let unsubscribeSse = () => {};
  try {
    unsubscribeSse = subscribeToGoal((code) => {
      if (code) localStorage.setItem(OVERLAY_GOAL_KEY, code);
      else localStorage.removeItem(OVERLAY_GOAL_KEY);
      onChange(decode(code));
    });
  } catch {
    /* EventSource unavailable — fall back to storage events only */
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key === OVERLAY_GOAL_KEY || e.key === null) onChange(getOverlayGoal());
  };
  window.addEventListener('storage', onStorage);

  return () => {
    unsubscribeSse();
    window.removeEventListener('storage', onStorage);
  };
}
