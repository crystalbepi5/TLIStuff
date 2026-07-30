import { useState } from 'react';
import type { Build } from '@torchlight-companion/build-data';
import { seedDataset } from '@torchlight-companion/build-data';
import type { BuildPatch } from '../context/plannerReducer';
import { HeroAvatar } from './HeroAvatar';

interface HeroWorkspaceProps {
  build: Build;
  patchBuild: (patch: BuildPatch, opts?: { groupKey?: string }) => void;
}

export function HeroWorkspace({ build, patchBuild }: HeroWorkspaceProps) {
  const [search, setSearch] = useState('');
  const [pendingHeroId, setPendingHeroId] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const heroes = seedDataset.heroes.filter(
    (h) => q === '' || h.name.toLowerCase().includes(q) || (h.season ?? '').toLowerCase().includes(q)
  );

  function selectHero(heroId: string) {
    if (heroId === build.heroId) return;
    // Talents are hero-specific -- swapping heroes silently drops any
    // currently-selected talents, so confirm first whenever there's
    // something real to lose.
    if (build.talentIds.length > 0) {
      setPendingHeroId(heroId);
      return;
    }
    patchBuild({ heroId, talentIds: [] });
  }

  function confirmSwap() {
    if (pendingHeroId) patchBuild({ heroId: pendingHeroId, talentIds: [] });
    setPendingHeroId(null);
  }

  const pendingHero = pendingHeroId ? seedDataset.heroes.find((h) => h.id === pendingHeroId) : undefined;

  return (
    <section className="pv-panel">
      <div className="pv-panel-header">
        <h2 className="pv-section-title">Hero</h2>
        <span className="pv-metadata">{seedDataset.heroes.length} heroes</span>
      </div>
      <div className="pv-panel-body">
        <div className="pv-search" style={{ marginBottom: 12 }}>
          <input
            type="search"
            placeholder="Search heroes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search heroes"
          />
        </div>

        <div className="pv-card-grid">
          {heroes.map((h) => {
            const selected = h.id === build.heroId;
            return (
              <button
                key={h.id}
                type="button"
                className={`pv-card pv-hero-card ${selected ? 'is-selected' : 'is-clickable'}`}
                onClick={() => selectHero(h.id)}
                aria-pressed={selected}
              >
                <HeroAvatar id={h.id} name={h.name} />
                <div style={{ minWidth: 0 }}>
                  <div className="pv-hero-card-name">{h.name}</div>
                  {h.season && (
                    <span className="pv-badge" style={{ marginTop: 4 }}>
                      {h.season}
                    </span>
                  )}
                  <p className="pv-hero-card-desc">{h.description}</p>
                </div>
              </button>
            );
          })}
          {heroes.length === 0 && <p className="pv-metadata">No heroes match "{search}".</p>}
        </div>
      </div>

      {pendingHero && (
        <>
          <div className="pv-overlay-scrim" onClick={() => setPendingHeroId(null)} />
          <div className="pv-dialog pv-dialog-center" role="alertdialog" aria-labelledby="hero-swap-title">
            <div className="pv-dialog-header">
              <h3 id="hero-swap-title" className="pv-section-title" style={{ margin: 0 }}>
                Switch to {pendingHero.name}?
              </h3>
            </div>
            <div className="pv-dialog-body">
              <p className="pv-metadata">
                Talents are hero-specific. Switching heroes will clear the {build.talentIds.length}{' '}
                talent{build.talentIds.length === 1 ? '' : 's'} currently selected. This can be undone
                with Ctrl/Cmd+Z.
              </p>
            </div>
            <div className="pv-dialog-footer">
              <button type="button" className="pv-btn pv-btn-ghost" onClick={() => setPendingHeroId(null)}>
                Cancel
              </button>
              <button type="button" className="pv-btn pv-btn-primary" onClick={confirmSwap}>
                Switch hero
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
