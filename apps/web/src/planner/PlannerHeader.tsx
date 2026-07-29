import { PanelLeft, PanelRight, Beaker, ExternalLink, Check } from 'lucide-react';

interface PlannerHeaderProps {
  buildName: string;
  onBuildNameChange: (name: string) => void;
  dataSource: string;
  navCollapsed: boolean;
  onToggleNav: () => void;
  onToggleRail: () => void;
  saveStatus: 'saved' | 'saving' | 'unsaved';
}

const SAVE_STATUS_LABEL: Record<PlannerHeaderProps['saveStatus'], string> = {
  saved: 'Saved locally',
  saving: 'Saving…',
  unsaved: 'Unsaved changes'
};

/** Top command bar: persistent across every workspace so the build identity,
 * save state, and navigation controls never scroll away. */
export function PlannerHeader({
  buildName,
  onBuildNameChange,
  dataSource,
  navCollapsed,
  onToggleNav,
  onToggleRail,
  saveStatus
}: PlannerHeaderProps) {
  return (
    <header className="pv-topbar">
      <button
        type="button"
        className="pv-icon-btn"
        onClick={onToggleNav}
        aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
        aria-pressed={navCollapsed}
      >
        <PanelLeft size={17} />
      </button>

      <span className="pv-app-title">Build Planner</span>

      <input
        className="pv-build-title"
        value={buildName}
        onChange={(e) => onBuildNameChange(e.target.value)}
        aria-label="Build name"
        maxLength={60}
      />

      <span className="pv-badge">
        <span className="pv-badge-dot" />
        {dataSource} data
      </span>

      <span className="pv-metadata pv-save-status" aria-live="polite">
        {saveStatus === 'saved' && <Check size={12} />}
        {SAVE_STATUS_LABEL[saveStatus]}
      </span>

      <span className="pv-nav-spacer" />

      <a className="pv-btn pv-btn-ghost pv-btn-sm" href="#craft">
        <Beaker size={14} />
        Crafting sim
      </a>
      <a className="pv-btn pv-btn-ghost pv-btn-sm" href="#overlay">
        <ExternalLink size={14} />
        Overlay
      </a>

      <button
        type="button"
        className="pv-icon-btn"
        onClick={onToggleRail}
        aria-label="Toggle analysis panel"
      >
        <PanelRight size={17} />
      </button>
    </header>
  );
}
