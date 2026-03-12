/**
 * GPTAgent — Agent + OpenAI streaming + tool calling.
 *
 * Extends Agent with automatic OpenAI chat completion streaming
 * and class-method tool calling. If you don't use OpenAI,
 * extend Agent directly and override onTurn().
 *
 * @example
 * ```javascript
 * import { GPTAgent, Phone } from "@pinecall/sdk/ai";
 *
 * class Receptionist extends GPTAgent {
 *   model = "gpt-4.1-nano";
 *   phone = new Phone("+13186330963");
 *   instructions = "You are a helpful receptionist.";
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

import OpenAI from "openai";
import { type Turn } from "../call.js";
import { Call } from "../call.js";
import { ConversationHistory } from "../history.js";
import { Agent, type AgentOptions } from "./agent.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface ToolDef {
    description: string;
    parameters: Record<string, unknown>;
    handler: string;
}

export interface GPTAgentOptions extends AgentOptions {
    /** OpenAI API key. Defaults to OPENAI_API_KEY env. */
    openaiKey?: string;
}

// ─── GPTAgent ────────────────────────────────────────────────────────────

export class GPTAgent extends Agent {
    // ── OpenAI config ───────────────────────────────────────────────────

    /** OpenAI model. Default: "gpt-4.1-nano". */
    model = "gpt-4.1-nano";
    /** LLM temperature. */
    temperature?: number;
    /** Max response tokens. */
    maxTokens?: number;
    /** Max tool calling rounds per turn. Default: 5. */
    maxToolRounds = 5;

    // ── Internal ─────────────────────────────────────────────────────────

    private _openai: OpenAI;

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

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(opts: GPTAgentOptions) {
        super(opts);
        this._openai = new OpenAI({
            apiKey: opts.openaiKey ?? process.env.OPENAI_API_KEY,
        });
    }

    // ── onTurn override: OpenAI streaming ────────────────────────────────

    override async onTurn(turn: Turn, call: Call, history: ConversationHistory): Promise<void> {
        await this._runLLM(turn, call, history, 0);
    }

    // ── Internal: LLM round (streams text, handles tools, recurses) ─────

    private async _runLLM(
        turn: Turn,
        call: Call,
        history: ConversationHistory,
        round: number,
    ): Promise<void> {
        if (round >= this.maxToolRounds) return;

        const tools = this._getOpenAITools();

        // Emit LLM start event for TUI — before API call so user sees it instantly
        this._core._emit("llm.start" as any, call, {
            model: this.model, round,
            messageId: turn.messageId, text: turn.text,
        } as any);

        const completion = await this._openai.chat.completions.create({
            model: this.model,
            messages: history.toMessages() as unknown as OpenAI.ChatCompletionMessageParam[],
            stream: true,
            ...(tools.length > 0 ? { tools } : {}),
            ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
            ...(this.maxTokens !== undefined ? { max_tokens: this.maxTokens } : {}),
        });

        let reply = "";
        const toolCalls: Array<{ id: string; name: string; args: string }> = [];
        // First round replies to the user's message; tool-continuation rounds use a fresh stream
        const stream = round === 0 ? call.replyStream(turn) : call.replyStream();

        for await (const chunk of completion) {
            if (stream.aborted) break;

            const choice = chunk.choices[0];
            if (!choice) continue;

            const token = choice.delta?.content;
            if (token) {
                stream.write(token);
                reply += token;
                this._core._emit("llm.token" as any, call, { token } as any);
            }

            if (choice.delta?.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                    if (tc.index !== undefined) {
                        if (!toolCalls[tc.index]) {
                            toolCalls[tc.index] = { id: tc.id ?? "", name: tc.function?.name ?? "", args: "" };
                        }
                        if (tc.id) toolCalls[tc.index].id = tc.id;
                        if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                        if (tc.function?.arguments) toolCalls[tc.index].args += tc.function.arguments;
                    }
                }
            }
        }

        stream.end();

        // Add any text reply to history
        if (reply && !stream.aborted) {
            history.addAssistant(reply, stream.messageId);
        }

        // Emit done event
        this._core._emit("llm.done" as any, call, { reply, aborted: stream.aborted } as any);

        // No tool calls → done
        if (toolCalls.length === 0 || stream.aborted) return;

        // Emit tool call events
        for (const tc of toolCalls) {
            this._core._emit("llm.tool_call" as any, call, { name: tc.name, args: tc.args } as any);
        }

        // Hold the call while tools execute — user hears music instead of silence.
        // The next round's replyStream.write() auto-unholds via bot.reply.stream.
        call.hold();

        // Execute tools and recurse
        await this._executeTools(toolCalls, history, call);
        await this._runLLM(turn, call, history, round + 1);
    }

    // ── Internal: execute tool calls ─────────────────────────────────────

    private async _executeTools(
        toolCalls: Array<{ id: string; name: string; args: string }>,
        history: ConversationHistory,
        call?: Call,
    ): Promise<void> {
        // Add assistant message with tool_calls
        history["_messages"].push({
            role: "assistant",
            content: "",
            tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.args },
            })),
        } as any);

        // Execute each tool
        for (const tc of toolCalls) {
            let result: unknown;
            try {
                const args = JSON.parse(tc.args);
                const handler = (this as any)[tc.name];
                if (typeof handler === "function") {
                    result = await handler.call(this, args, call);
                } else {
                    result = { error: `Unknown tool: ${tc.name}` };
                }
            } catch (err) {
                result = { error: String(err) };
            }

            // Emit tool result event
            if (call) {
                this._core._emit("llm.tool_result" as any, call, { name: tc.name, result } as any);
            }

            history["_messages"].push({
                role: "tool" as any,
                content: JSON.stringify(result),
                tool_call_id: tc.id,
            } as any);
        }
    }

    // ── Internal: build OpenAI tools array ───────────────────────────────

    private _getOpenAITools(): OpenAI.ChatCompletionTool[] {
        const Ctor = this.constructor as typeof GPTAgent;
        const toolDefs = Ctor._tools;
        if (!toolDefs || toolDefs.size === 0) return [];

        const tools: OpenAI.ChatCompletionTool[] = [];
        for (const [name, def] of toolDefs) {
            tools.push({
                type: "function",
                function: {
                    name,
                    description: def.description,
                    parameters: def.parameters as any,
                },
            });
        }
        return tools;
    }
}
