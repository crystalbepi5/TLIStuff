import type { Edge, GraphSpec, NodeSpec, Trigger } from "./types.js";

/** Fluent helper for assembling a GraphSpec. */
export class GraphBuilder {
  private nodes: NodeSpec[] = [];
  private edges: Edge[] = [];

  /** Declare a role. Defaults to flow-triggered (runs on upstream output). */
  node(role: string, trigger: Trigger = { type: "flow" }): this {
    this.nodes.push({ role, trigger });
    return this;
  }

  /** Self-ticking loop. */
  loop(role: string, ms: number): this {
    return this.node(role, { type: "interval", ms });
  }

  /** Output of `from` feeds (and triggers) `to`. */
  flow(from: string, to: string): this {
    this.edges.push({ type: "flow", from, to });
    return this;
  }

  /** `from` may abort and inhibit `to` — "who can veto whom". */
  veto(from: string, to: string): this {
    this.edges.push({ type: "veto", from, to });
    return this;
  }

  build(): GraphSpec {
    const spec: GraphSpec = { nodes: this.nodes, edges: this.edges };
    validateGraph(spec);
    return spec;
  }
}

export function defineGraph(define: (g: GraphBuilder) => void): GraphSpec {
  const builder = new GraphBuilder();
  define(builder);
  return builder.build();
}

export function validateGraph(spec: GraphSpec): void {
  const roles = new Set<string>();
  for (const node of spec.nodes) {
    if (roles.has(node.role)) {
      throw new Error(`duplicate node role "${node.role}"`);
    }
    if (node.trigger.type === "interval" && node.trigger.ms <= 0) {
      throw new Error(`node "${node.role}": interval must be > 0ms`);
    }
    roles.add(node.role);
  }
  for (const edge of spec.edges) {
    for (const end of [edge.from, edge.to]) {
      if (!roles.has(end)) {
        throw new Error(
          `${edge.type} edge ${edge.from} -> ${edge.to}: unknown role "${end}"`,
        );
      }
    }
    if (edge.from === edge.to) {
      throw new Error(`${edge.type} edge on "${edge.from}" is a self-loop`);
    }
  }
}

/** Render the graph as a Mermaid flowchart for docs and debugging. */
export function toMermaid(spec: GraphSpec): string {
  const lines = ["flowchart LR"];
  for (const node of spec.nodes) {
    const label =
      node.trigger.type === "interval"
        ? `${node.role}\\n(every ${node.trigger.ms}ms)`
        : node.role;
    lines.push(`  ${sanitize(node.role)}["${label}"]`);
  }
  for (const edge of spec.edges) {
    const arrow = edge.type === "veto" ? "-. veto .->" : "-->";
    lines.push(`  ${sanitize(edge.from)} ${arrow} ${sanitize(edge.to)}`);
  }
  return lines.join("\n");
}

function sanitize(role: string): string {
  return role.replace(/[^A-Za-z0-9_]/g, "_");
}
