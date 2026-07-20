import test from "node:test";
import assert from "node:assert/strict";
import {
  AgentRegistry,
  GraphRunner,
  defineGraph,
  toMermaid,
  validateGraph,
} from "../dist/index.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("registry resolves bound agents and swap changes the next run", async () => {
  const registry = new AgentRegistry();
  registry
    .register({ name: "impl-a", run: () => "from-a" })
    .register({ name: "impl-b", run: () => "from-b" })
    .bind("worker", "impl-a");

  const graph = defineGraph((g) => g.node("worker", { type: "manual" }));
  const runner = new GraphRunner(graph, registry);

  assert.equal(await runner.trigger("worker"), "from-a");
  registry.swap("worker", "impl-b");
  assert.equal(await runner.trigger("worker"), "from-b");
  assert.deepEqual(registry.currentBindings(), { worker: "impl-b" });
});

test("flow edges deliver a node's output as the next node's input", async () => {
  const registry = new AgentRegistry();
  const seen = [];
  registry
    .register({ name: "source", run: () => 21 })
    .register({
      name: "doubler",
      run: (input) => {
        const doubled = input * 2;
        seen.push(doubled);
        return doubled;
      },
    })
    .bindAll({ producer: "source", consumer: "doubler" });

  const graph = defineGraph((g) => {
    g.node("producer", { type: "manual" });
    g.node("consumer");
    g.flow("producer", "consumer");
  });
  const runner = new GraphRunner(graph, registry);
  await runner.trigger("producer");
  await sleep(20);
  assert.deepEqual(seen, [42]);
});

test("veto edges abort in-flight runs and inhibit until released", async () => {
  const registry = new AgentRegistry();
  let targetRuns = 0;
  registry
    .register({
      name: "watcher",
      run: (input, ctx) => {
        if (input === "veto") ctx.veto("threshold breached");
        else ctx.clearVeto();
        return input;
      },
    })
    .register({
      name: "slow-target",
      run: async (_input, ctx) => {
        targetRuns += 1;
        await sleep(100);
        return ctx.signal.aborted ? "aborted" : "done";
      },
    })
    .bindAll({ monitor: "watcher", pipeline: "slow-target" });

  const graph = defineGraph((g) => {
    g.node("monitor", { type: "manual" });
    g.node("pipeline", { type: "manual" });
    g.veto("monitor", "pipeline");
  });

  const events = [];
  const runner = new GraphRunner(graph, registry, {
    onEvent: (e) => events.push(e.type),
  });

  const inflight = runner.trigger("pipeline"); // starts the slow run
  await sleep(10);
  await runner.trigger("monitor", "veto"); // aborts it and inhibits
  assert.equal(await inflight, undefined);
  assert.ok(events.includes("node:aborted"));
  assert.deepEqual(runner.inhibitions(), {
    pipeline: { monitor: "threshold breached" },
  });

  // Inhibited: trigger is skipped, agent not invoked again.
  await runner.trigger("pipeline");
  assert.equal(targetRuns, 1);

  await runner.trigger("monitor", "ok"); // clearVeto releases the target
  assert.deepEqual(runner.inhibitions(), {});
  assert.equal(await runner.trigger("pipeline"), "done");
});

test("interval nodes tick until stopped and record history", async () => {
  const registry = new AgentRegistry();
  let ticks = 0;
  registry
    .register({ name: "ticker", run: () => ++ticks })
    .bind("heartbeat", "ticker");

  const graph = defineGraph((g) => g.loop("heartbeat", 25));
  const runner = new GraphRunner(graph, registry);
  runner.start();
  await sleep(120);
  runner.stop();
  const after = ticks;
  assert.ok(after >= 2, `expected >=2 ticks, got ${after}`);
  await sleep(60);
  assert.equal(ticks, after, "no ticks after stop()");
  assert.ok(runner.history.every((r) => r.role === "heartbeat"));
  assert.ok(runner.history.every((r) => r.status === "success"));
});

test("graph validation rejects bad specs; mermaid export renders edges", () => {
  assert.throws(
    () =>
      validateGraph({
        nodes: [{ role: "a", trigger: { type: "manual" } }],
        edges: [{ type: "flow", from: "a", to: "missing" }],
      }),
    /unknown role/,
  );
  assert.throws(
    () =>
      defineGraph((g) => {
        g.node("a", { type: "manual" });
        g.node("a", { type: "manual" });
      }),
    /duplicate/,
  );

  const mermaid = toMermaid(
    defineGraph((g) => {
      g.loop("src", 100);
      g.node("dst");
      g.flow("src", "dst");
      g.veto("dst", "src");
    }),
  );
  assert.match(mermaid, /flowchart LR/);
  assert.match(mermaid, /src --> dst/);
  assert.match(mermaid, /dst -\. veto \.-> src/);
});

test("agent errors are recorded without crashing the runner", async () => {
  const registry = new AgentRegistry();
  registry
    .register({
      name: "flaky",
      run: () => {
        throw new Error("boom");
      },
    })
    .bind("job", "flaky");

  const events = [];
  const runner = new GraphRunner(
    defineGraph((g) => g.node("job", { type: "manual" })),
    registry,
    { onEvent: (e) => events.push(e) },
  );
  assert.equal(await runner.trigger("job"), undefined);
  const error = events.find((e) => e.type === "node:error");
  assert.ok(error);
  assert.match(String(error.error), /boom/);
  assert.equal(runner.history.at(-1)?.status, "error");
});
