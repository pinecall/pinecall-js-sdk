/**
 * GPTAgent — Agent with server-side LLM + tool calling.
 *
 * The server handles OpenAI calls directly — zero SDK round-trips.
 * Define tools as class methods and register them with defineTool().
 *
 * @example
 * ```javascript
 * import { GPTAgent, Phone } from "@pinecall/sdk/ai";
 *
 * class Receptionist extends GPTAgent {
 *   model = "pinecall:gpt-4.1-nano";
 *   phone = new Phone("+13186330963");
 *   prompt = "You are a helpful receptionist.";
 *
 *   async bookTable({ date, guests }) {
 *     return { confirmed: true, date, guests };
 *   }
 * }
 *
 * Receptionist.defineTool("bookTable", "Book a table", {
 *   date: { type: "string", description: "Date" },
 *   guests: { type: "number", description: "Party size" },
 * });
 *
 * export default Receptionist;
 * ```
 */

import { Agent, type AgentOptions } from "./agent.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface ToolDef {
    description: string;
    parameters: Record<string, unknown>;
    handler: string;
}

export interface GPTAgentOptions extends AgentOptions {}

// ─── GPTAgent ────────────────────────────────────────────────────────────

export class GPTAgent extends Agent {
    /** OpenAI model. Always runs server-side. Default: "gpt-4.1-nano". */
    override model = "gpt-4.1-nano";

    /** @internal GPTAgent always uses server-side LLM. */
    protected override _serverSideLLM = true;

    // ── Tool registry (class-level) ──────────────────────────────────────

    /** @internal Tool definitions registered via defineTool(). */
    static _tools?: Map<string, ToolDef>;

    /**
     * Register a tool on this agent class.
     * The method with the same name must exist on the class.
     */
    static defineTool(
        name: string,
        description: string,
        properties: Record<string, unknown>,
    ): void {
        if (!this._tools) this._tools = new Map();
        this._tools.set(name, {
            description,
            parameters: {
                type: "object",
                properties,
                required: Object.keys(properties),
            },
            handler: name,
        });
    }
}
