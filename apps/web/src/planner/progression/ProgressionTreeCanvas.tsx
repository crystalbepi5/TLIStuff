import { useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { List, Map as MapIcon, Minus, Plus, RotateCcw, Search } from 'lucide-react';
import type { ProgressionNode, ProgressionTree } from '@torchlight-companion/build-data';
import { ProgressionTreeGraph } from '../../progression/ProgressionTreeGraph';
import { describeModifiers } from '../buildUtils';

const MIN_SCALE = 0.6;
const MAX_SCALE = 4;
const MINIMAP_SIZE = 96;

/** Same "no name -> type + tlidbId -> raw id" fallback ProgressionTreeGraph
 * uses internally (not exported from there, so re-derived here rather than
 * modifying that file -- see this module's header comment). */
function nodeLabel(node: ProgressionNode): string {
  if (node.name) return node.name;
  if (node.type) return `${node.type} node #${node.tlidbId ?? node.id}`;
  return node.id;
}

function nodeBounds(tree: ProgressionTree) {
  const xs = tree.nodes.map((n) => n.position?.x ?? 0);
  const ys = tree.nodes.map((n) => n.position?.y ?? 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  return { minX, minY, span };
}

interface ProgressionTreeCanvasProps {
  tree: ProgressionTree;
  selectedIds: Set<string>;
  onToggle: (nodeId: string) => void;
}

/**
 * Chrome built around the real ProgressionTreeGraph (unmodified -- its own
 * node/edge rendering, hover info, and click-to-toggle stay exactly as
 * they were): pan, zoom, reset/fit, a minimap, a search-driven node list,
 * and a fully accessible list-view fallback that never depends on the SVG
 * at all. No prerequisite/point-budget logic is added here either --
 * still every node stays freely toggleable, matching the underlying
 * component and the fact that neither rule is confirmed against the game.
 */
export function ProgressionTreeCanvas({ tree, selectedIds, onToggle }: ProgressionTreeCanvasProps) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [search, setSearch] = useState('');
  const [listView, setListView] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  function zoomBy(factor: number) {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor)));
  }

  function resetView() {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }

  function onWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  const q = search.trim().toLowerCase();
  const matches = q ? tree.nodes.filter((n) => nodeLabel(n).toLowerCase().includes(q)) : [];

  const { minX, minY, span } = nodeBounds(tree);
  function toMinimapPoint(n: ProgressionNode) {
    const x = n.position?.x ?? 0;
    const y = n.position?.y ?? 0;
    return {
      x: ((x - minX) / span) * MINIMAP_SIZE,
      y: ((y - minY) / span) * MINIMAP_SIZE
    };
  }

  return (
    <div className="pv-progression-canvas">
      <div className="pv-progression-toolbar">
        <div className="pv-search" style={{ flex: 1 }}>
          <Search size={14} />
          <input
            type="search"
            placeholder={`Search ${tree.nodes.length} nodes…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {!listView && (
          <>
            <button type="button" className="pv-icon-btn" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
              <Minus size={15} />
            </button>
            <button type="button" className="pv-icon-btn" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
              <Plus size={15} />
            </button>
            <button type="button" className="pv-icon-btn" onClick={resetView} aria-label="Reset / fit view">
              <RotateCcw size={15} />
            </button>
          </>
        )}
        <button
          type="button"
          className={`pv-icon-btn ${listView ? 'is-active' : ''}`}
          onClick={() => setListView((v) => !v)}
          aria-pressed={listView}
          aria-label={listView ? 'Switch to graph view' : 'Switch to accessible list view'}
        >
          {listView ? <MapIcon size={15} /> : <List size={15} />}
        </button>
      </div>

      {q && matches.length > 0 && !listView && (
        <div className="pv-progression-search-results">
          {matches.slice(0, 8).map((n) => (
            <button key={n.id} type="button" className="pv-badge pv-badge-btn" onClick={() => onToggle(n.id)}>
              {selectedIds.has(n.id) ? '✓ ' : ''}
              {nodeLabel(n)}
            </button>
          ))}
        </div>
      )}

      {listView ? (
        <div className="pv-scroll-region" style={{ maxHeight: 460 }}>
          {tree.nodes
            .filter((n) => q === '' || nodeLabel(n).toLowerCase().includes(q))
            .map((n) => (
              <label key={n.id} className="pv-checkbox-row">
                <input type="checkbox" checked={selectedIds.has(n.id)} onChange={() => onToggle(n.id)} />
                <span>
                  {nodeLabel(n)}
                  <span className="pv-metadata"> — {describeModifiers(n.modifiers)}</span>
                </span>
              </label>
            ))}
        </div>
      ) : (
        <div className="pv-progression-viewport" onWheel={onWheel}>
          <div
            className="pv-progression-pan-zoom"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
          >
            <ProgressionTreeGraph tree={tree} selectedIds={selectedIds} onToggle={onToggle} />
          </div>

          <svg className="pv-progression-minimap" width={MINIMAP_SIZE} height={MINIMAP_SIZE} aria-hidden="true">
            <rect width={MINIMAP_SIZE} height={MINIMAP_SIZE} className="pv-progression-minimap-bg" />
            {tree.nodes.map((n) => {
              const p = toMinimapPoint(n);
              return (
                <circle
                  key={n.id}
                  cx={p.x}
                  cy={p.y}
                  r={selectedIds.has(n.id) ? 2 : 1.3}
                  className={selectedIds.has(n.id) ? 'pv-progression-minimap-node is-selected' : 'pv-progression-minimap-node'}
                />
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
