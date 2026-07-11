import { useEffect, useState } from 'react';
import { App } from './App';
import { BuildPlanner } from './planner/BuildPlanner';

/**
 * Chooses a view from the URL hash so the transparent overlay (`App`) stays the
 * default and completely untouched — the Electron shell loads the root with no
 * hash and gets the overlay. `#planner` opens the build planner as a normal,
 * opaque page (used in a browser, not the overlay window).
 */
export function Root() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (hash === '#planner') return <BuildPlanner />;
  return <App />;
}
