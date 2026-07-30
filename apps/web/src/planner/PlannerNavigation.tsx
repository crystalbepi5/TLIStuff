import type { ComponentType } from 'react';
import {
  LayoutDashboard,
  UserRound,
  Wand2,
  Shield,
  GitBranch,
  Workflow,
  Sparkles,
  BookHeart,
  Bone,
  Share2
} from 'lucide-react';
import type { PlannerSection } from './plannerSections';

interface NavEntry {
  id: PlannerSection;
  label: string;
  icon: ComponentType<{ size?: number }>;
}

const NAV_ENTRIES: NavEntry[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'hero', label: 'Hero', icon: UserRound },
  { id: 'skills', label: 'Skills', icon: Wand2 },
  { id: 'equipment', label: 'Equipment', icon: Shield },
  { id: 'talents', label: 'Talents', icon: GitBranch },
  { id: 'progressionTrees', label: 'Progression Trees', icon: Workflow },
  { id: 'pactSpirits', label: 'Pact Spirits', icon: Sparkles },
  { id: 'memory', label: 'Memory Revival', icon: BookHeart },
  { id: 'vorax', label: 'Vorax', icon: Bone },
  { id: 'share', label: 'Share', icon: Share2 }
];

interface PlannerNavigationProps {
  active: PlannerSection;
  onSelect: (section: PlannerSection) => void;
  collapsed: boolean;
}

/** Left build-navigation rail. The active workspace persists across
 * navigation -- switching sections never resets scroll position or state in
 * the other sections, it just changes which one is mounted in the main
 * region. */
export function PlannerNavigation({ active, onSelect, collapsed }: PlannerNavigationProps) {
  return (
    <nav className="pv-nav" aria-label="Build sections">
      <span className="pv-nav-section-label">Build</span>
      {NAV_ENTRIES.map((entry) => {
        const Icon = entry.icon;
        const isActive = entry.id === active;
        return (
          <button
            key={entry.id}
            type="button"
            className={`pv-nav-item ${isActive ? 'is-active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            title={collapsed ? entry.label : undefined}
            onClick={() => onSelect(entry.id)}
          >
            <Icon size={16} />
            <span>{entry.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
