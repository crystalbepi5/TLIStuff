/**
 * The "graph of loops" from the post, runnable offline with stub agents:
 *
 *   live-traffic ──> challenger-model ──> head-to-head-eval
 *        │      └──> incumbent-model ──┘
 *        └────────> drift-monitor ──> alert-threshold ──> automatic-rollback
 *   training-loop (self-ticking)          │ veto                  │ veto
 *   held-out-eval (manual, never seen     └──> training-loop      └──> challenger-model
 *                  by the training loop)
 *
 * Every node is a ROLE. The implementations below are stubs; each one can be
 * replaced by a claudeAgent(...) or anything else via registry.swap() — the
 * graph never changes. This demo swaps the drift monitor mid-flight.
 *
 * Run with:  pnpm --filter @torchlight-companion/loop-graph example
 */
import { AgentRegistry } from "../registry.js";
import { defineGraph, toMermaid } from "../graph.js";
import { GraphRunner } from "../runner.js";
import type { Agent } from "../types.js";

interface TrafficBatch {
  tick: number;
  values: number[];
}

// Deterministic PRNG so the demo behaves the same on every run.
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const rng = makeRng(42);
const BASELINE_MEAN = 0.5;
const DRIFT_STARTS_AT_TICK = 8;

const mean = (xs: number[]): number =>
  xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);

// ---------------------------------------------------------------------------
// Stub agents. Each fulfils one role; all are swappable.
// ---------------------------------------------------------------------------

let tick = 0;
const liveTraffic: Agent<unknown, TrafficBatch> = {
  name: "sim-live-traffic",
  run: () => {
    tick += 1;
    const drift = tick >= DRIFT_STARTS_AT_TICK ? 0.06 * (tick - DRIFT_STARTS_AT_TICK + 1) : 0;
    const values = Array.from({ length: 32 }, () => BASELINE_MEAN + drift + (rng() - 0.5) * 0.2);
    return { tick, values };
  },
};

function makeModel(name: string, key: "challenger" | "incumbent", noise: number): Agent {
  return {
    name,
    run: (input, ctx) => {
      const batch = input as TrafficBatch;
      // "Accuracy" degrades as the data drifts away from what the model knows.
      const score = Math.max(0, 1 - Math.abs(mean(batch.values) - BASELINE_MEAN) * 2 - noise);
      ctx.memory.set(`score:${key}`, score);
      return { model: key, tick: batch.tick, score: Number(score.toFixed(3)) };
    },
  };
}

const headToHeadEval: Agent = {
  name: "score-comparator",
  run: (_input, ctx) => {
    const challenger = (ctx.memory.get("score:challenger") as number) ?? 0;
    const incumbent = (ctx.memory.get("score:incumbent") as number) ?? 0;
    const winner = challenger >= incumbent ? "challenger" : "incumbent";
    ctx.memory.set("head-to-head-winner", winner);
    return { challenger, incumbent, winner };
  },
};

const naiveDriftMonitor: Agent = {
  name: "naive-drift-monitor",
  run: (input) => {
    const batch = input as TrafficBatch;
    return { tick: batch.tick, drift: Math.abs(mean(batch.values) - BASELINE_MEAN) };
  },
};

const robustDriftMonitor: Agent = {
  name: "robust-drift-monitor",
  run: (input, ctx) => {
    const batch = input as TrafficBatch;
    const m = mean(batch.values);
    const variance = mean(batch.values.map((v) => (v - m) ** 2));
    const drift = Math.abs(m - BASELINE_MEAN) / Math.sqrt(variance + 1e-9);
    ctx.log(`z-drift=${drift.toFixed(2)} (a different algorithm, same role)`);
    return { tick: batch.tick, drift };
  },
};

const alertThreshold: Agent = {
  name: "static-threshold",
  run: (input, ctx) => {
    const { tick: t, drift } = input as { tick: number; drift: number };
    const limit = 0.25;
    if (drift > limit) {
      ctx.veto(`drift ${drift.toFixed(2)} exceeded ${limit} at tick ${t}`);
      return { tick: t, breached: true, drift };
    }
    ctx.clearVeto();
    return { tick: t, breached: false, drift };
  },
};

function makeRollback(registry: AgentRegistry): Agent {
  return {
    name: "binding-rollback",
    run: (input, ctx) => {
      const alert = input as { breached: boolean; drift: number; tick: number };
      if (!alert.breached) return { rolledBack: false };
      if (ctx.memory.get("servingModel") === "incumbent") return { rolledBack: false };
      ctx.memory.set("servingModel", "incumbent");
      ctx.veto(`rolled back to incumbent (drift ${alert.drift.toFixed(2)})`);
      // The rollback agent can even rewire the registry itself — swap the
      // "serving" role without touching the graph:
      registry.swap("drift-monitor", "robust-drift-monitor");
      ctx.log("swapped drift-monitor -> robust-drift-monitor for the post-mortem");
      return { rolledBack: true, atTick: alert.tick };
    },
  };
}

const trainingLoop: Agent = {
  name: "sgd-training-loop",
  run: (_input, ctx) => {
    const steps = ((ctx.memory.get("trainSteps") as number) ?? 0) + 1;
    ctx.memory.set("trainSteps", steps);
    return { steps };
  },
};

const heldOutEval: Agent = {
  name: "holdout-eval",
  run: (_input, ctx) => {
    // Fixed data the training loop never sees.
    const holdout = Array.from({ length: 64 }, () => BASELINE_MEAN + (rng() - 0.5) * 0.2);
    const score = Number((1 - Math.abs(mean(holdout) - BASELINE_MEAN) * 2).toFixed(3));
    return { servingModel: ctx.memory.get("servingModel"), holdoutScore: score };
  },
};

// ---------------------------------------------------------------------------
// The graph: pure topology. No implementation names appear here.
// ---------------------------------------------------------------------------

const graph = defineGraph((g) => {
  g.loop("live-traffic", 250);
  g.node("challenger-model");
  g.node("incumbent-model");
  g.node("head-to-head-eval");
  g.node("drift-monitor");
  g.node("alert-threshold");
  g.node("automatic-rollback");
  g.loop("training-loop", 400);
  g.node("held-out-eval", { type: "manual" });

  g.flow("live-traffic", "challenger-model");
  g.flow("live-traffic", "incumbent-model");
  g.flow("challenger-model", "head-to-head-eval");
  g.flow("incumbent-model", "head-to-head-eval");
  g.flow("live-traffic", "drift-monitor");
  g.flow("drift-monitor", "alert-threshold");
  g.flow("alert-threshold", "automatic-rollback");

  g.veto("alert-threshold", "training-loop");
  g.veto("automatic-rollback", "challenger-model");
});

const registry = new AgentRegistry();
registry
  .register(liveTraffic)
  .register(makeModel("challenger-v2", "challenger", 0.02))
  .register(makeModel("incumbent-v1", "incumbent", 0.1))
  .register(headToHeadEval)
  .register(naiveDriftMonitor)
  .register(robustDriftMonitor)
  .register(alertThreshold)
  .register(trainingLoop)
  .register(heldOutEval);
registry.register(makeRollback(registry));

registry.bindAll({
  "live-traffic": "sim-live-traffic",
  "challenger-model": "challenger-v2",
  "incumbent-model": "incumbent-v1",
  "head-to-head-eval": "score-comparator",
  "drift-monitor": "naive-drift-monitor",
  "alert-threshold": "static-threshold",
  "automatic-rollback": "binding-rollback",
  "training-loop": "sgd-training-loop",
  "held-out-eval": "holdout-eval",
});

const runner = new GraphRunner(graph, registry, {
  onEvent: (event) => {
    switch (event.type) {
      case "node:success":
        if (event.role === "head-to-head-eval" || event.role === "automatic-rollback") {
          console.log(`  [${event.role} via ${event.agent}]`, event.output);
        }
        break;
      case "node:inhibited":
        console.log(`  !! ${event.role} inhibited by ${event.by}: ${event.reason}`);
        break;
      case "node:released":
        console.log(`  ${event.role} released`);
        break;
      case "log":
        console.log(`  (${event.role}) ${event.message}`);
        break;
      default:
        break;
    }
  },
});

console.log("Graph:\n" + toMermaid(graph) + "\n");
runner.memory.set("servingModel", "challenger");
runner.start();
console.log("running — drift begins at tick 8...\n");

setTimeout(() => {
  void (async () => {
    runner.stop();
    const holdout = await runner.trigger("held-out-eval");
    console.log("\nheld-out eval:", holdout);
    console.log("final bindings:", registry.currentBindings());
    console.log("inhibitions still held:", runner.inhibitions());
    const trained = runner.memory.get("trainSteps");
    console.log(`training steps completed before veto: ${String(trained)}`);
  })();
}, 5000);
