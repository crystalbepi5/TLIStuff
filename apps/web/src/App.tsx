import { useEffect, useMemo, useState } from 'react';
import type { LootFeedSnapshot } from '@torchlight-companion/domain';
import { seedDataset, indexDataset, type Build } from '@torchlight-companion/build-data';
import { evaluateBuild } from '@torchlight-companion/build-calc';
import { fetchLootRecent, subscribeToLootEvents } from './api';
import { getOverlayGoal, OVERLAY_GOAL_KEY } from './overlayGoal';

const datasetIndex = indexDataset(seedDataset);

function GoalPanel({ goal }: { goal: Build }) {
  const summary = useMemo(() => {
    const hero = datasetIndex.hero(goal.heroId);
    const skill = datasetIndex.activeSkill(goal.activeSkillId);
    try {
      const report = evaluateBuild(goal, datasetIndex);
      return { heroName: hero?.name, skillName: skill?.name, dps: report.damage.dps };
    } catch {
      return { heroName: hero?.name, skillName: skill?.name, dps: undefined };
    }
  }, [goal]);

  return (
    <section className="hud-panel goal-panel">
      <span className="hud-label">Building toward</span>
      <strong className="goal-name">{goal.name}</strong>
      <span className="goal-sub">
        {[summary.heroName, summary.skillName].filter(Boolean).join(' · ')}
      </span>
      {summary.dps !== undefined && (
        <span className="goal-dps">target {Math.round(summary.dps).toLocaleString()} DPS</span>
      )}
    </section>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<LootFeedSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState<Build | null>(() => getOverlayGoal());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === OVERLAY_GOAL_KEY || e.key === null) setGoal(getOverlayGoal());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchLootRecent()
      .then(({ data }) => {
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      });

    const unsubscribe = subscribeToLootEvents((event) => {
      setSnapshot((prev) => {
        const base: LootFeedSnapshot = prev ?? { recentEvents: [], netWorth: 0 };
        return {
          ...base,
          recentEvents: [event, ...base.recentEvents].slice(0, 200),
          netWorth: base.netWorth + (event.estimatedValue ?? 0)
        };
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const recentEvents = snapshot?.recentEvents ?? [];

  return (
    <main className="overlay">
      {error && <p className="offline-banner">Local agent offline — start it with pnpm --filter @torchlight-companion/local-agent dev.</p>}

      {goal && <GoalPanel goal={goal} />}

      <section className="hud-panel net-worth-panel">
        <span className="hud-label">Net Worth</span>
        <strong className="net-worth-value">{(snapshot?.netWorth ?? 0).toFixed(1)}</strong>
      </section>

      {snapshot?.activeRun && (
        <section className="hud-panel run-panel">
          <span className="hud-label">Current Run</span>
          <strong className="run-value">{snapshot.activeRun.totalValue.toFixed(1)}</strong>
        </section>
      )}

      <section className="hud-panel loot-feed">
        <span className="hud-label">Recent Loot</span>
        <ul className="loot-list">
          {recentEvents.map((event) => (
            <li key={event.id} className="loot-toast">
              <span className="loot-quantity">×{event.quantity}</span>
              <span className="loot-name">Item #{event.configBaseId}</span>
              {event.estimatedValue !== undefined && <span className="loot-value">{event.estimatedValue.toFixed(1)}</span>}
            </li>
          ))}
          {recentEvents.length === 0 && <li className="loot-empty">No loot yet — go kill something.</li>}
        </ul>
      </section>
    </main>
  );
}
