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
        await this._streamOpenAIResponse(turn, call, history);
    }

    // ── Internal: OpenAI streaming + tools ───────────────────────────────

    private async _streamOpenAIResponse(
        turn: Turn,
        call: Call,
        history: ConversationHistory,
    ): Promise<void> {
        const tools = this._getOpenAITools();

        const requestParams: OpenAI.ChatCompletionCreateParamsStreaming = {
            model: this.model,
            messages: history.toMessages() as OpenAI.ChatCompletionMessageParam[],
            stream: true,
            ...(tools.length > 0 ? { tools } : {}),
            ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
            ...(this.maxTokens !== undefined ? { max_tokens: this.maxTokens } : {}),
        };

        const completion = await this._openai.chat.completions.create(requestParams);

        let reply = "";
        const toolCalls: Array<{
            id: string;
            name: string;
            args: string;
        }> = [];

        const stream = call.replyStream(turn);

        for await (const chunk of completion) {
            if (stream.aborted) break;

            const choice = chunk.choices[0];
            if (!choice) continue;

            const token = choice.delta?.content;
            if (token) {
                stream.write(token);
                reply += token;
            }

            if (choice.delta?.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                    if (tc.index !== undefined) {
                        if (!toolCalls[tc.index]) {
                            toolCalls[tc.index] = {
                                id: tc.id ?? "",
                                name: tc.function?.name ?? "",
                                args: "",
                            };
                        }
                        if (tc.id) toolCalls[tc.index].id = tc.id;
                        if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                        if (tc.function?.arguments) toolCalls[tc.index].args += tc.function.arguments;
                    }
                }
            }
        }

        stream.end();

        if (reply && !stream.aborted) {
            history.addAssistant(reply, stream.messageId);
        }

        if (toolCalls.length > 0 && !stream.aborted) {
            await this._handleToolCalls(toolCalls, turn, call, history);
        }
    }

    private async _handleToolCalls(
        toolCalls: Array<{ id: string; name: string; args: string }>,
        turn: Turn,
        call: Call,
        history: ConversationHistory,
    ): Promise<void> {
        const assistantMsg: any = {
            role: "assistant",
            content: null,
            tool_calls: toolCalls.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.args },
            })),
        };
        history["_messages"].push(assistantMsg);

        for (const tc of toolCalls) {
            let result: unknown;
            try {
                const args = JSON.parse(tc.args);
                const handler = (this as any)[tc.name];
                if (typeof handler === "function") {
                    result = await handler.call(this, args);
                } else {
                    result = { error: `Unknown tool: ${tc.name}` };
                }
            } catch (err) {
                result = { error: String(err) };
            }

            history["_messages"].push({
                role: "tool" as any,
                content: JSON.stringify(result),
                tool_call_id: tc.id,
            } as any);
        }

        const stream = call.replyStream(turn);

        try {
            const completion = await this._openai.chat.completions.create({
                model: this.model,
                messages: history["_messages"] as OpenAI.ChatCompletionMessageParam[],
                stream: true,
                ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
            });

            let reply = "";
            for await (const chunk of completion) {
                if (stream.aborted) break;
                const token = chunk.choices[0]?.delta?.content;
                if (token) {
                    stream.write(token);
                    reply += token;
                }
            }

            stream.end();
        } catch (err) {
            stream.end();
            console.error("[GPTAgent] Tool response error:", err);
        }
    }

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
