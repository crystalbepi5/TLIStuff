import type { Agent } from "./types.js";

/**
 * Holds every known agent implementation and the role -> agent bindings.
 *
 * Swapping an implementation is a one-line `swap()` call; the runner resolves
 * bindings at call time, so the next run of that role picks up the new agent
 * with no change to the graph.
 */
export class AgentRegistry {
  private agents = new Map<string, Agent<never, unknown>>();
  private bindings = new Map<string, string>();

  /** Register an implementation. Returns the registry for chaining. */
  register(agent: Agent<never, unknown>): this {
    if (this.agents.has(agent.name)) {
      throw new Error(`agent "${agent.name}" is already registered`);
    }
    this.agents.set(agent.name, agent);
    return this;
  }

  /** Bind a role to a registered agent by name. */
  bind(role: string, agentName: string): this {
    if (!this.agents.has(agentName)) {
      throw new Error(
        `cannot bind role "${role}": agent "${agentName}" is not registered`,
      );
    }
    this.bindings.set(role, agentName);
    return this;
  }

  /** Apply a whole binding table at once (e.g. loaded from JSON config). */
  bindAll(bindings: Record<string, string>): this {
    for (const [role, agentName] of Object.entries(bindings)) {
      this.bind(role, agentName);
    }
    return this;
  }

  /** Rebind a role to a different implementation — safe while running. */
  swap(role: string, agentName: string): this {
    return this.bind(role, agentName);
  }

  /** The agent currently bound to a role. Throws when unbound. */
  resolve(role: string): Agent<never, unknown> {
    const agentName = this.bindings.get(role);
    if (agentName === undefined) {
      throw new Error(`no agent bound to role "${role}"`);
    }
    const agent = this.agents.get(agentName);
    if (agent === undefined) {
      throw new Error(
        `role "${role}" is bound to missing agent "${agentName}"`,
      );
    }
    return agent;
  }

  /** Name of the agent bound to a role, or undefined. */
  boundName(role: string): string | undefined {
    return this.bindings.get(role);
  }

  /** All registered agent names. */
  agentNames(): string[] {
    return [...this.agents.keys()];
  }

  /** Snapshot of the current binding table. */
  currentBindings(): Record<string, string> {
    return Object.fromEntries(this.bindings);
  }
}
