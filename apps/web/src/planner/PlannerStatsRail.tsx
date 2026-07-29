import { TrendingUp, AlertTriangle } from 'lucide-react';
import type { evaluateBuild } from '@torchlight-companion/build-calc';
import type { AffixSwapSuggestion } from '@torchlight-companion/build-calc';

type Report = ReturnType<typeof evaluateBuild> | { error: string };

interface PlannerStatsRailProps {
  report: Report;
  marginal: AffixSwapSuggestion[] | null;
  marginalBusy: boolean;
  hasGear: boolean;
  onRunMarginalAnalysis: () => void;
}

/** Right analysis rail in its "build stats" mode -- always-visible live
 * calculation output, independent of whichever workspace is active in the
 * main region. A future selection-inspector mode will share this same rail
 * region (see Phase 4). */
export function PlannerStatsRail({
  report,
  marginal,
  marginalBusy,
  hasGear,
  onRunMarginalAnalysis
}: PlannerStatsRailProps) {
  if ('error' in report) {
    return (
      <aside className="pv-rail" aria-label="Build statistics">
        <div className="pv-panel-body">
          <p className="pv-empty-hint">{report.error}</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="pv-rail" aria-label="Build statistics">
      <div className="pv-panel-header">
        <span className="pv-panel-label">Live stats</span>
      </div>

      <div className="pv-panel-body">
        <div className="pv-stat-hero">
          <span className="pv-panel-label">DPS</span>
          <span className="pv-stat-hero-value pv-tabular">
            {Math.round(report.damage.dps).toLocaleString()}
          </span>
        </div>

        <div className="pv-stat-row">
          <span className="pv-stat-row-label">Average hit</span>
          <span className="pv-stat-row-value pv-tabular">
            {Math.round(report.damage.averageHit).toLocaleString()}
          </span>
        </div>
        <div className="pv-stat-row">
          <span className="pv-stat-row-label">Crit rate</span>
          <span className="pv-stat-row-value pv-tabular">{report.damage.critRate.toFixed(1)}%</span>
        </div>
        <div className="pv-stat-row">
          <span className="pv-stat-row-label">Crit multiplier</span>
          <span className="pv-stat-row-value pv-tabular">
            {report.damage.critMultiplier.toFixed(2)}×
          </span>
        </div>
        <div className="pv-stat-row">
          <span className="pv-stat-row-label">Rate</span>
          <span className="pv-stat-row-value pv-tabular">{report.damage.rate.toFixed(2)}/s</span>
        </div>

        <hr className="pv-divider" />
        <span className="pv-panel-label">Damage by element</span>
        {Object.entries(report.damage.perElement).map(([el, dmg]) => (
          <div className="pv-stat-row" key={el}>
            <span className={`pv-stat-row-label pv-el pv-el-${el}`}>{el}</span>
            <span className="pv-stat-row-value pv-tabular">
              {Math.round(dmg as number).toLocaleString()}
            </span>
          </div>
        ))}

        <hr className="pv-divider" />
        <span className="pv-panel-label">Defense</span>
        <div className="pv-stat-row">
          <span className="pv-stat-row-label">Life</span>
          <span className="pv-stat-row-value pv-tabular">
            {Math.round(report.defense.life).toLocaleString()}
          </span>
        </div>
        <div className="pv-stat-row">
          <span className="pv-stat-row-label">Energy shield</span>
          <span className="pv-stat-row-value pv-tabular">
            {Math.round(report.defense.energyShield).toLocaleString()}
          </span>
        </div>
        <div className="pv-stat-row">
          <span className="pv-stat-row-label">Eff. HP (elemental)</span>
          <span className="pv-stat-row-value pv-tabular">
            {Math.round(report.defense.effectiveHpVsElemental).toLocaleString()}
          </span>
        </div>
        {Object.entries(report.defense.resists).map(([el, val]) => (
          <div className="pv-stat-row" key={el}>
            <span className={`pv-stat-row-label pv-el pv-el-${el}`}>{el} res</span>
            <span className="pv-stat-row-value pv-tabular">{val as number}%</span>
          </div>
        ))}

        <hr className="pv-divider" />
        <span className="pv-panel-label">Best upgrade</span>
        <p className="pv-metadata" style={{ margin: '6px 0' }}>
          Tries every equipped affix against every other affix valid for that slot, one swap at a
          time, and reports the single largest DPS gain found.
        </p>
        <button
          type="button"
          className="pv-btn pv-btn-sm"
          onClick={onRunMarginalAnalysis}
          disabled={marginalBusy || !hasGear}
        >
          <TrendingUp size={13} />
          {marginalBusy ? 'Analyzing…' : 'Find best upgrade'}
        </button>
        {marginal && marginal.length === 0 && (
          <p className="pv-metadata" style={{ marginTop: 6 }}>
            No upgrade found from the current affix pool.
          </p>
        )}
        {marginal && marginal.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {marginal.map((s, i) => (
              <div className="pv-stat-row" key={i}>
                <span className="pv-stat-row-label">
                  {s.slot}: {s.fromAffixName} → {s.toAffixName}
                </span>
                <span className="pv-stat-row-value pv-tabular">
                  +{Math.round(s.gain).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        {report.warnings.length > 0 && (
          <>
            <hr className="pv-divider" />
            <span className="pv-panel-label">Warnings</span>
            <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
              {report.warnings.map((w, i) => (
                <div className="pv-warning-item" key={i}>
                  <AlertTriangle size={13} />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
