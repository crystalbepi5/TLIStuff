import type { ReactNode } from 'react';

interface PlannerShellProps {
  header: ReactNode;
  nav: ReactNode;
  main: ReactNode;
  rail: ReactNode;
  drawer?: ReactNode;
  navCollapsed: boolean;
  railCollapsed: boolean;
  railOpenMobile: boolean;
}

/** Four-region CSS Grid application shell: top command bar, left nav rail,
 * main workspace, right analysis rail, plus an optional bottom drawer.
 * Purely presentational -- all state (collapse, active section, etc.) lives
 * in the caller. */
export function PlannerShell({
  header,
  nav,
  main,
  rail,
  drawer,
  navCollapsed,
  railCollapsed,
  railOpenMobile
}: PlannerShellProps) {
  const classes = [
    'planner-shell',
    navCollapsed ? 'is-nav-collapsed' : '',
    railCollapsed ? 'is-rail-collapsed' : '',
    railOpenMobile ? 'is-rail-open' : '',
    drawer ? 'has-drawer' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      {header}
      {nav}
      <div className="pv-main" role="main">
        <div className="pv-main-inner">{main}</div>
      </div>
      {rail}
      {drawer}
    </div>
  );
}
