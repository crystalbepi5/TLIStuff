import { useEffect, useState } from 'react';
import type { LootFeedSnapshot } from '@torchlight-companion/domain';
import { fetchLootRecent, subscribeToLootEvents } from './api';

export function App() {
  const [snapshot, setSnapshot] = useState<LootFeedSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

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
