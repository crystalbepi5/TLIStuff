import { useMemo, useState } from 'react';
import type { ProgressionNode, ProgressionTree } from '@torchlight-companion/build-data';

const PADDING = 30;
const VIEW_SIZE = 560;
const NODE_RADIUS = 7;

/** `more` values are stored as a decimal multiplier (0.08 -> x1.08, i.e. 8%
 * more -- see aggregate()'s `more *= 1 + mod.value`), while `increased`
 * values are already plain percentage numbers. Scale `more` by 100 before
 * display or it reads as "+0.08%" instead of "+8%". */
function describeNodeModifiers(node: ProgressionNode): string {
  if (node.modifiers.length === 0) return '(no modeled effect yet)';
  return node.modifiers
    .map((m) => {
      const value = m.op === 'more' ? m.value * 100 : m.value;
      return `${value >= 0 ? '+' : ''}${value}${m.op === 'flat' ? '' : '%'} ${m.stat}`;
    })
    .join(', ');
}

/** Talent Tree nodes have no `name` in the scraped data at all (unlike Void
 * Chart, which is fully named) -- fall back to type + the real in-game
 * tlidbId rather than a raw internal uuid, which at least cross-references
 * to tlidb.com. */
function nodeLabel(node: ProgressionNode): string {
  if (node.name) return node.name;
  if (node.type) return `${node.type} node #${node.tlidbId ?? node.id}`;
  return node.id;
}

/**
 * Real node-graph view of a Void Chart / Talent Tree, using each node's own
 * scraped (x, y) position and connections -- data no tlidb.com-style HTML
 * scrape can recover (that site's pages expose a flat node list, not
 * connectivity or layout). Click a node to toggle it in/out of the build.
 * No prerequisite/point-budget gating is enforced: neither is confirmed
 * against the real game, so every node stays freely toggleable rather than
 * guessing a rule that might be wrong.
 */
export function ProgressionTreeGraph({
  tree,
  selectedIds,
  onToggle
}: {
  tree: ProgressionTree;
  selectedIds: Set<string>;
  onToggle: (nodeId: string) => void;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  const { nodesById, scale } = useMemo(() => {
    const nodesById = new Map(tree.nodes.map((n) => [n.id, n]));
    const xs = tree.nodes.map((n) => n.position?.x ?? 0);
    const ys = tree.nodes.map((n) => n.position?.y ?? 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const scale = (x: number, y: number): [number, number] => [
      PADDING + ((x - minX) / span) * (VIEW_SIZE - 2 * PADDING),
      PADDING + ((y - minY) / span) * (VIEW_SIZE - 2 * PADDING)
    ];
    return { nodesById, scale };
  }, [tree]);

  const hoverNode = hoverId ? nodesById.get(hoverId) : null;
  const selectedInTree = tree.nodes.filter((n) => selectedIds.has(n.id)).length;

  return (
    <div className="progression-graph">
      <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} className="progression-graph-svg">
        {tree.nodes.map((node) => {
          const [x1, y1] = scale(node.position?.x ?? 0, node.position?.y ?? 0);
          return node.connections
            .filter((id) => nodesById.has(id))
            .map((targetId) => {
              const target = nodesById.get(targetId);
              if (!target) return null;
              const [x2, y2] = scale(target.position?.x ?? 0, target.position?.y ?? 0);
              return (
                <line
                  key={`${node.id}-${targetId}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  className="progression-graph-edge"
                />
              );
            });
        })}
        {tree.nodes.map((node) => {
          const [x, y] = scale(node.position?.x ?? 0, node.position?.y ?? 0);
          const selected = selectedIds.has(node.id);
          const hasEffect = node.modifiers.length > 0;
          return (
            <circle
              key={node.id}
              cx={x}
              cy={y}
              r={NODE_RADIUS}
              className={[
                'progression-graph-node',
                selected ? 'is-selected' : '',
                hasEffect ? 'has-effect' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onToggle(node.id)}
              onMouseEnter={() => setHoverId(node.id)}
              onMouseLeave={() => setHoverId((id) => (id === node.id ? null : id))}
            >
              <title>
                {nodeLabel(node) + '\n' + describeNodeModifiers(node)}
              </title>
            </circle>
          );
        })}
      </svg>
      <div className="progression-graph-info">
        {hoverNode ? (
          <>
            <strong>{nodeLabel(hoverNode)}</strong>
            {hoverNode.description && <p>{hoverNode.description}</p>}
            <p className="tier-effect">{describeNodeModifiers(hoverNode)}</p>
          </>
        ) : (
          <p className="tier-effect">Hover a node for details, click to toggle it.</p>
        )}
        <p className="tier-effect">
          {selectedInTree} node{selectedInTree === 1 ? '' : 's'} selected in this tree
        </p>
      </div>
    </div>
  );
}
