import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from 'react';
import type { Build } from '@torchlight-companion/build-data';
import { buildFromUrl, defaultBuild } from '../buildUtils';
import type { PlannerSection } from '../plannerSections';
import { createPlannerState, plannerReducer, type BuildPatch } from './plannerReducer';
import { loadStoredEnvelope, saveEnvelope } from './persistence';

export type SaveStatus = 'saved' | 'saving' | 'unsaved';

/** Debounce before a build change is written to localStorage -- long enough
 * that a burst of edits (dragging a search box, toggling several affixes)
 * coalesces into one write, short enough that a refresh rarely loses more
 * than a few hundred milliseconds of work. */
const SAVE_DEBOUNCE_MS = 500;

interface PlannerContextValue {
  build: Build;
  activeSection: PlannerSection;
  setActiveSection: (section: PlannerSection) => void;
  patchBuild: (patch: BuildPatch, opts?: { groupKey?: string }) => void;
  loadBuild: (build: Build) => void;
  resetBuild: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: SaveStatus;
}

const PlannerContext = createContext<PlannerContextValue | null>(null);

function resolveInitialBuild(): { build: Build; section: PlannerSection } {
  const shared = buildFromUrl();
  if (shared) return { build: shared, section: 'overview' };
  const stored = loadStoredEnvelope();
  if (stored) return { build: stored.build, section: (stored.activeSection as PlannerSection) ?? 'overview' };
  return { build: defaultBuild(), section: 'overview' };
}

export function PlannerProvider({ children }: { children: ReactNode }) {
  const initial = useRef<{ build: Build; section: PlannerSection } | null>(null);
  if (!initial.current) initial.current = resolveInitialBuild();

  const [state, dispatch] = useReducer(plannerReducer, initial.current.build, createPlannerState);
  const [activeSection, setActiveSection] = useState<PlannerSection>(initial.current.section);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  // Debounced localStorage persistence. Skips the very first render (the
  // build we just loaded from storage/URL doesn't need writing back).
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    setSaveStatus('unsaved');
    const timer = setTimeout(() => {
      setSaveStatus('saving');
      const ok = saveEnvelope(state.build, activeSection);
      setSaveStatus(ok ? 'saved' : 'unsaved');
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state.build, activeSection]);

  // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo. Skipped while a
  // text-entry control has focus so undo doesn't fight the browser's own
  // native input-undo (e.g. mid-edit in the build name field).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTextEntry =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;
      if (isTextEntry) return;

      const key = e.key.toLowerCase();
      if (key === 'z' && e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'REDO' });
      } else if (key === 'z') {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
      } else if (key === 'y') {
        e.preventDefault();
        dispatch({ type: 'REDO' });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const patchBuild = useCallback((patch: BuildPatch, opts?: { groupKey?: string }) => {
    dispatch(opts?.groupKey !== undefined ? { type: 'PATCH', patch, groupKey: opts.groupKey } : { type: 'PATCH', patch });
  }, []);

  const loadBuild = useCallback((build: Build) => {
    dispatch({ type: 'LOAD_BUILD', build });
  }, []);

  const resetBuild = useCallback(() => {
    dispatch({ type: 'LOAD_BUILD', build: defaultBuild() });
    setActiveSection('overview');
  }, []);

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);

  const value = useMemo<PlannerContextValue>(
    () => ({
      build: state.build,
      activeSection,
      setActiveSection,
      patchBuild,
      loadBuild,
      resetBuild,
      undo,
      redo,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      saveStatus
    }),
    [state.build, state.past.length, state.future.length, activeSection, saveStatus, patchBuild, loadBuild, resetBuild, undo, redo]
  );

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerContextValue {
  const ctx = useContext(PlannerContext);
  if (!ctx) throw new Error('usePlanner must be used within a PlannerProvider');
  return ctx;
}
