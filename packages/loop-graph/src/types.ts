/**
 * Core contracts for the loop-graph runtime.
 *
 * The central idea: graph nodes are ROLES, not implementations. An Agent is a
 * concrete implementation of a role, registered in an AgentRegistry and bound
 * to the role by name. The runner resolves role -> agent at call time, so
 * implementations can be swapped while the graph is running.
 */

/** Context handed to every agent invocation. */
export interface AgentContext {
  /** The role this agent is currently fulfilling. */
  role: string;
  /** Aborted when the run is vetoed or the runner stops. */
  signal: AbortSignal;
  /** Structured log line attributed to this run. */
  log(message: string): void;
  /** Emit a custom observability event (surfaced via the runner's onEvent). */
  emit(name: string, payload?: unknown): void;
  /**
   * Shared blackboard for the whole graph. Use for state that multiple
   * loops need to see (e.g. model scores both eval nodes read).
   */
  memory: Map<string, unknown>;
  /**
   * Fire the veto edges declared FROM this role: aborts the targets'
   * in-flight runs and inhibits their future triggers until cleared.
   */
  veto(reason: string): void;
  /** Clear vetoes previously placed by this role. */
  clearVeto(): void;
}

/**
 * A pluggable unit of work. Implementations range from ten lines of
 * arithmetic to a full Claude call — the graph cannot tell the difference,
 * which is exactly the point.
 */
export interface Agent<I = unknown, O = unknown> {
  /** Unique name within a registry (e.g. "psi-drift-monitor"). */
  name: string;
  description?: string;
  run(input: I, ctx: AgentContext): Promise<O> | O;
}

/** How a node decides to run. */
export type Trigger =
  /** Self-ticking loop. */
  | { type: "interval"; ms: number }
  /** Runs when an upstream flow edge delivers output (the default). */
  | { type: "flow" }
  /** Only runs when runner.trigger(role, input) is called. */
  | { type: "manual" };

export interface NodeSpec {
  /** Role name — the stable identity agents are bound against. */
  role: string;
  trigger: Trigger;
}

export type Edge =
  /** Output of `from` becomes the input of `to`, triggering it. */
  | { type: "flow"; from: string; to: string }
  /** `from` may veto `to`: abort its in-flight run and inhibit it. */
  | { type: "veto"; from: string; to: string };

export interface GraphSpec {
  nodes: NodeSpec[];
  edges: Edge[];
}

export type RunStatus = "success" | "error" | "aborted";

export interface RunRecord {
  runId: number;
  role: string;
  agent: string;
  startedAt: number;
  durationMs: number;
  status: RunStatus;
  output?: unknown;
  error?: unknown;
}

/** Lifecycle events surfaced through GraphRunner's onEvent hook. */
export type RunnerEvent =
  | { type: "node:start"; role: string; agent: string; runId: number }
  | {
      type: "node:success";
      role: string;
      agent: string;
      runId: number;
      output: unknown;
      durationMs: number;
    }
  | {
      type: "node:error";
      role: string;
      agent: string;
      runId: number;
      error: unknown;
    }
  | { type: "node:aborted"; role: string; agent: string; runId: number }
  | { type: "node:inhibited"; role: string; by: string; reason: string }
  | { type: "node:released"; role: string }
  | { type: "node:skipped"; role: string; reason: "busy" | "inhibited" }
  | { type: "log"; role: string; runId: number; message: string }
  | { type: "custom"; role: string; name: string; payload?: unknown };
