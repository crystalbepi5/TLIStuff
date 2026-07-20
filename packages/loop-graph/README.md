# @torchlight-companion/loop-graph

A tiny runtime for building a **graph of loops** — the pattern where a system
is not one agent loop but several, and the reliability lives in the edges:
who watches whom, who can veto whom.

The core trick that makes it modular: **graph nodes are roles, not
implementations**. Concrete agents are registered in an `AgentRegistry` and
bound to roles by name. The runner resolves the binding **at call time**, so
any agent can be swapped for another — mid-run, from config, or even by
another node in the graph — without touching the topology.

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│ GraphSpec (pure topology)  │        │ AgentRegistry                │
│  roles + flow/veto edges   │        │  name -> implementation      │
└──────────────┬─────────────┘        │  role -> name (swappable)    │
               │                      └──────────────┬───────────────┘
               └──────────────┬──────────────────────┘
                              ▼
                        GraphRunner
              interval ticks · flow delivery · vetoes
              abort signals · history · event stream
```

## Concepts

| Concept | What it is |
|---|---|
| **Role** | A named slot in the graph (`"drift-monitor"`). Stable identity. |
| **Agent** | An implementation of a role: `{ name, run(input, ctx) }`. A stub, a heuristic, or a Claude call — the graph can't tell. |
| **Registry** | Holds all agents plus the role→agent binding table. `swap()` rebinds live. |
| **Flow edge** | Output of one node becomes the input of (and triggers) the next. |
| **Veto edge** | A watcher may abort the target's in-flight run and inhibit future runs until it clears the veto. This is the "who can veto whom" reliability layer. |
| **Triggers** | `interval` (self-ticking loop), `flow` (runs on upstream output), `manual` (`runner.trigger()`). |
| **Memory** | A shared blackboard (`ctx.memory`) all loops can read/write. |

## Quick start

```ts
import { AgentRegistry, GraphRunner, defineGraph } from "@torchlight-companion/loop-graph";

const graph = defineGraph((g) => {
  g.loop("live-traffic", 1000);          // self-ticking loop
  g.node("drift-monitor");               // runs when traffic flows in
  g.node("alert-threshold");
  g.loop("training-loop", 5000);
  g.flow("live-traffic", "drift-monitor");
  g.flow("drift-monitor", "alert-threshold");
  g.veto("alert-threshold", "training-loop");  // alerts can freeze training
});

const registry = new AgentRegistry()
  .register({ name: "prod-traffic", run: () => fetchBatch() })
  .register({ name: "psi-monitor", run: (batch) => computePsi(batch) })
  .register({ name: "static-threshold", run: (d, ctx) => {
    if (d.psi > 0.25) ctx.veto("drift breach"); else ctx.clearVeto();
    return d;
  }})
  .register({ name: "trainer", run: () => trainStep() })
  .bindAll({
    "live-traffic": "prod-traffic",
    "drift-monitor": "psi-monitor",
    "alert-threshold": "static-threshold",
    "training-loop": "trainer",
  });

const runner = new GraphRunner(graph, registry, { onEvent: console.log });
runner.start();

// Later — swap an implementation while everything keeps running:
registry.swap("drift-monitor", "llm-drift-monitor");
```

## Swapping in a Claude-backed agent

Any role can be fulfilled by a model instead of code. The adapter uses the
official Anthropic SDK (`ANTHROPIC_API_KEY` from the environment):

```ts
import { claudeAgent } from "@torchlight-companion/loop-graph";

registry.register(
  claudeAgent({
    name: "llm-drift-monitor",
    system:
      "You are a drift monitor. Given a JSON batch of feature values, reply " +
      'with JSON only: {"drift": <0..1>, "explanation": "..."}.',
    parseOutput: (text) => JSON.parse(text),
  }),
);
registry.swap("drift-monitor", "llm-drift-monitor");
```

Because bindings resolve per run, you can A/B two implementations by swapping
on a schedule, roll back by rebinding, or let a node in the graph do the
swap itself (the example's rollback agent does exactly this).

## The example

`src/examples/ml-pipeline.ts` wires the full graph from the post — challenger
vs incumbent on live traffic, head-to-head eval, drift monitor, alert
threshold, automatic rollback, training loop, and a held-out eval the
training loop never sees. Drift is injected mid-run; the alert vetoes the
training loop, the rollback vetoes the challenger and swaps the drift monitor
implementation live.

```sh
pnpm --filter @torchlight-companion/loop-graph build
pnpm --filter @torchlight-companion/loop-graph example
```

`toMermaid(graph)` prints the topology as a Mermaid flowchart for docs.

## Where to run it

The package is plain Node/TypeScript with no framework assumptions, so a
graph can live wherever a Node process can:

- **Locally / long-running service**: `node dist/your-graph.js` under pm2,
  systemd, or Docker — the natural home for interval loops.
- **Serverless / cron** (GitHub Actions, Supabase Edge Functions, etc.):
  skip `start()` and call `await runner.trigger("role")` per invocation —
  the graph becomes a pipeline you fire on a schedule.
- **Inside this monorepo**: depend on it from any app via
  `"@torchlight-companion/loop-graph": "workspace:*"`.

## Testing

```sh
pnpm --filter @torchlight-companion/loop-graph build
pnpm --filter @torchlight-companion/loop-graph test
```
