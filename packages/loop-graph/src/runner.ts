import type { AgentRegistry } from "./registry.js";
import type {
  AgentContext,
  Edge,
  GraphSpec,
  RunRecord,
  RunnerEvent,
} from "./types.js";
import { validateGraph } from "./graph.js";

export interface GraphRunnerOptions {
  /** Observability hook — every lifecycle event flows through here. */
  onEvent?: (event: RunnerEvent) => void;
  /** Cap on retained run history (default 200). */
  historyLimit?: number;
}

interface NodeState {
  running: AbortController | null;
  /** role -> reason, for every upstream veto currently held against us. */
  inhibitedBy: Map<string, string>;
  timer: ReturnType<typeof setInterval> | null;
}

/**
 * Executes a GraphSpec against an AgentRegistry.
 *
 * - interval nodes tick themselves;
 * - flow edges deliver a node's output as the next node's input;
 * - veto edges let a watcher abort and inhibit its target;
 * - agents are resolved from the registry AT CALL TIME, so
 *   `registry.swap(role, otherAgent)` takes effect on the very next run.
 */
export class GraphRunner {
  readonly memory = new Map<string, unknown>();
  readonly history: RunRecord[] = [];

  private readonly states = new Map<string, NodeState>();
  private readonly flowsFrom = new Map<string, Edge[]>();
  private readonly vetoesFrom = new Map<string, Edge[]>();
  private readonly historyLimit: number;
  private readonly onEvent: (event: RunnerEvent) => void;
  private nextRunId = 1;
  private started = false;

  constructor(
    private readonly graph: GraphSpec,
    private readonly registry: AgentRegistry,
    options: GraphRunnerOptions = {},
  ) {
    validateGraph(graph);
    this.historyLimit = options.historyLimit ?? 200;
    this.onEvent = options.onEvent ?? (() => {});
    for (const node of graph.nodes) {
      this.states.set(node.role, {
        running: null,
        inhibitedBy: new Map(),
        timer: null,
      });
    }
    for (const edge of graph.edges) {
      const index = edge.type === "flow" ? this.flowsFrom : this.vetoesFrom;
      const list = index.get(edge.from) ?? [];
      list.push(edge);
      index.set(edge.from, list);
    }
  }

  /** Start all interval loops. Flow/manual nodes wait for their triggers. */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const node of this.graph.nodes) {
      if (node.trigger.type !== "interval") continue;
      const state = this.state(node.role);
      state.timer = setInterval(() => {
        void this.runNode(node.role, undefined);
      }, node.trigger.ms);
    }
  }

  /** Stop interval loops and abort anything in flight. */
  stop(): void {
    this.started = false;
    for (const state of this.states.values()) {
      if (state.timer !== null) {
        clearInterval(state.timer);
        state.timer = null;
      }
      state.running?.abort();
    }
  }

  /** Manually fire a node (works for any trigger type). */
  async trigger(role: string, input?: unknown): Promise<unknown> {
    if (!this.states.has(role)) {
      throw new Error(`unknown role "${role}"`);
    }
    return this.runNode(role, input);
  }

  /** Lift an inhibition placed on `role` from the outside. */
  release(role: string): void {
    const state = this.state(role);
    if (state.inhibitedBy.size === 0) return;
    state.inhibitedBy.clear();
    this.onEvent({ type: "node:released", role });
  }

  /** Roles currently inhibited, with who is holding the veto. */
  inhibitions(): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    for (const [role, state] of this.states) {
      if (state.inhibitedBy.size > 0) {
        result[role] = Object.fromEntries(state.inhibitedBy);
      }
    }
    return result;
  }

  private state(role: string): NodeState {
    const state = this.states.get(role);
    if (state === undefined) throw new Error(`unknown role "${role}"`);
    return state;
  }

  private async runNode(role: string, input: unknown): Promise<unknown> {
    const state = this.state(role);
    if (state.inhibitedBy.size > 0) {
      this.onEvent({ type: "node:skipped", role, reason: "inhibited" });
      return undefined;
    }
    if (state.running !== null) {
      this.onEvent({ type: "node:skipped", role, reason: "busy" });
      return undefined;
    }

    const runId = this.nextRunId++;
    let agentName = "<unbound>";
    const controller = new AbortController();
    state.running = controller;
    const startedAt = Date.now();

    try {
      const agent = this.registry.resolve(role);
      agentName = agent.name;
      this.onEvent({ type: "node:start", role, agent: agentName, runId });

      const ctx: AgentContext = {
        role,
        signal: controller.signal,
        memory: this.memory,
        log: (message) => this.onEvent({ type: "log", role, runId, message }),
        emit: (name, payload) =>
          this.onEvent({ type: "custom", role, name, payload }),
        veto: (reason) => this.applyVeto(role, reason),
        clearVeto: () => this.clearVeto(role),
      };

      const output = await agent.run(input as never, ctx);
      const durationMs = Date.now() - startedAt;

      if (controller.signal.aborted) {
        this.record({
          runId,
          role,
          agent: agentName,
          startedAt,
          durationMs,
          status: "aborted",
        });
        this.onEvent({ type: "node:aborted", role, agent: agentName, runId });
        return undefined;
      }

      this.record({
        runId,
        role,
        agent: agentName,
        startedAt,
        durationMs,
        status: "success",
        output,
      });
      this.onEvent({
        type: "node:success",
        role,
        agent: agentName,
        runId,
        output,
        durationMs,
      });

      for (const edge of this.flowsFrom.get(role) ?? []) {
        void this.runNode(edge.to, output).catch(() => {
          /* downstream errors surface via their own node:error events */
        });
      }
      return output;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (controller.signal.aborted) {
        this.record({
          runId,
          role,
          agent: agentName,
          startedAt,
          durationMs,
          status: "aborted",
        });
        this.onEvent({ type: "node:aborted", role, agent: agentName, runId });
        return undefined;
      }
      this.record({
        runId,
        role,
        agent: agentName,
        startedAt,
        durationMs,
        status: "error",
        error,
      });
      this.onEvent({ type: "node:error", role, agent: agentName, runId, error });
      return undefined;
    } finally {
      if (state.running === controller) {
        state.running = null;
      }
    }
  }

  private applyVeto(from: string, reason: string): void {
    for (const edge of this.vetoesFrom.get(from) ?? []) {
      const target = this.state(edge.to);
      target.inhibitedBy.set(from, reason);
      target.running?.abort();
      this.onEvent({ type: "node:inhibited", role: edge.to, by: from, reason });
    }
  }

  private clearVeto(from: string): void {
    for (const edge of this.vetoesFrom.get(from) ?? []) {
      const target = this.state(edge.to);
      if (target.inhibitedBy.delete(from) && target.inhibitedBy.size === 0) {
        this.onEvent({ type: "node:released", role: edge.to });
      }
    }
  }

  private record(record: RunRecord): void {
    this.history.push(record);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }
  }
}
