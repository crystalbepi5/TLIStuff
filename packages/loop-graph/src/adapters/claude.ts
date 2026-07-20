import Anthropic from "@anthropic-ai/sdk";
import type { Agent, AgentContext } from "../types.js";

export interface ClaudeAgentOptions {
  /** Unique agent name for the registry. */
  name: string;
  /** System prompt describing the role this agent fulfils. */
  system: string;
  /** Defaults to claude-opus-4-8. */
  model?: string;
  /** Defaults to 16000. */
  maxTokens?: number;
  /** Turn the node input into the user message (default: JSON.stringify). */
  formatInput?: (input: unknown, ctx: AgentContext) => string;
  /** Parse the model's text into the node output (default: raw text). */
  parseOutput?: (text: string) => unknown;
  /** Bring your own client (otherwise built from the environment). */
  client?: Anthropic;
}

/**
 * Wraps a Claude call as an Agent, so an LLM implementation of any role is
 * interchangeable with a heuristic one:
 *
 *   registry.register(claudeAgent({
 *     name: "llm-drift-monitor",
 *     system: "You watch feature distributions for drift. Reply with JSON " +
 *             '{"drift": number, "explanation": string}.',
 *     parseOutput: (text) => JSON.parse(text),
 *   }));
 *   registry.swap("drift-monitor", "llm-drift-monitor");
 */
export function claudeAgent(options: ClaudeAgentOptions): Agent {
  const client = options.client ?? new Anthropic();
  const model = options.model ?? "claude-opus-4-8";
  const maxTokens = options.maxTokens ?? 16000;
  const formatInput =
    options.formatInput ?? ((input: unknown) => JSON.stringify(input ?? null));
  const parseOutput = options.parseOutput ?? ((text: string) => text);

  const agent: Agent = {
    name: options.name,
    run: async (input, ctx) => {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        system: options.system,
        messages: [{ role: "user", content: formatInput(input, ctx) }],
      });
      if (response.stop_reason === "refusal") {
        throw new Error(`claude agent "${options.name}": request was refused`);
      }
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      return parseOutput(text);
    },
  };
  if (options.system) {
    agent.description = options.system.slice(0, 200);
  }
  return agent;
}
