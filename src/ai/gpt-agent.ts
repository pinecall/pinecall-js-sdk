/**
 * GPTAgent — high-level class-based voice agent with OpenAI.
 *
 * Wraps Pinecall + Agent + OpenAI + ConversationHistory into a
 * declarative class. Subclass it, set fields, define tool methods,
 * and run.
 *
 * Works in both TypeScript and JavaScript — no decorators required.
 *
 * @example
 * ```javascript
 * const { GPTAgent } = require("@pinecall/sdk/ai");
 *
 * class Receptionist extends GPTAgent {
 *   model = "gpt-4.1-nano";
 *   voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
 *   instructions = "You are a helpful receptionist.";
 *   greeting = "Hello! How can I help you?";
 *
 *   async bookReservation({ date, guests }) {
 *     return { confirmed: true, date, guests };
 *   }
 * }
 *
 * Receptionist.defineTool("bookReservation", "Book a reservation", {
 *   date: { type: "string", description: "Date" },
 *   guests: { type: "number", description: "Party size" },
 * });
 *
 * module.exports = Receptionist;
 * ```
 */

import OpenAI from "openai";
import { Pinecall } from "../client.js";
import { Agent, type AgentConfig, type ChannelConfig, type VoiceShortcut } from "../agent.js";
import { Call, type Turn } from "../call.js";
import { ConversationHistory } from "../history.js";
import { Channel, Phone, WebRTC } from "./channel.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface ToolDef {
    description: string;
    parameters: Record<string, unknown>;
    /** Method name on the class instance. */
    handler: string;
}

export interface GPTAgentOptions {
    /** Your Pinecall API key. */
    apiKey: string;
    /** OpenAI API key. Defaults to OPENAI_API_KEY env. */
    openaiKey?: string;
    /** WebSocket URL override. */
    url?: string;
}

// ─── GPTAgent ────────────────────────────────────────────────────────────

export class GPTAgent {
    // ── Config fields (set in subclass) ──────────────────────────────────

    /** OpenAI model. Default: "gpt-4.1-nano". */
    model = "gpt-4.1-nano";
    /** Voice — string shortcut or full TTS config object. */
    voice?: VoiceShortcut;
    /** Language code (e.g. "es"). */
    language?: string;
    /** STT config. */
    stt?: AgentConfig["stt"];
    /** Turn detection mode. */
    turnDetection?: AgentConfig["turnDetection"];
    /** Interruption config. */
    interruption?: AgentConfig["interruption"];
    /** System prompt for the LLM. */
    instructions = "You are a helpful voice assistant. Be concise.";
    /** Auto-greeting on call.started. */
    greeting?: string;
    /** Which turn event to respond on. Default: "eager.turn". */
    turnEvent: "eager.turn" | "turn.end" = "eager.turn";
    /** LLM temperature. */
    temperature?: number;
    /** Max response tokens. */
    maxTokens?: number;

    // ── Channel fields ───────────────────────────────────────────────────

    /**
     * Agent-level defaults — applied to all channels.
     * Channels can override any of these per-channel.
     *
     * @example
     * defaults = {
     *   voice: { provider: "elevenlabs", voice_id: "abc", speed: 1.05 },
     *   stt: { provider: "deepgram", model: "nova-3" },
     *   turnDetection: "smart_turn",
     *   interruption: { enabled: true, min_duration_ms: 300 },
     * };
     */
    defaults?: Partial<ChannelConfig>;

    /** Single phone — string or Phone instance. */
    phone?: string | Phone;
    /** Multiple phones. */
    phones?: (string | Phone)[];
    /** WebRTC channel. */
    webrtc?: WebRTC;
    /** Additional channels (generic). */
    channels?: Channel[];

    // ── Internal ─────────────────────────────────────────────────────────

    private _pc: Pinecall;
    private _agent: Agent;
    private _openai: OpenAI;
    private _histories = new Map<string, ConversationHistory>();
    private _started = false;

    // ── Tool registry (class-level) ──────────────────────────────────────

    /** @internal Tool definitions registered via defineTool(). */
    static _tools?: Map<string, ToolDef>;

    /**
     * Register a tool on this agent class.
     *
     * The method with the same name must exist on the class.
     *
     * @param name - Method name on the class
     * @param description - What the tool does (for OpenAI)
     * @param properties - JSON Schema properties shorthand
     *
     * @example
     * ```javascript
     * class MyAgent extends GPTAgent {
     *   async searchFlights({ from, to, date }) {
     *     return await flightAPI.search(from, to, date);
     *   }
     * }
     * MyAgent.defineTool("searchFlights", "Search available flights", {
     *   from: { type: "string", description: "Departure city" },
     *   to:   { type: "string", description: "Arrival city" },
     *   date: { type: "string", description: "Date (YYYY-MM-DD)" },
     * });
     * ```
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
        this._pc = new Pinecall({
            apiKey: opts.apiKey,
            url: opts.url,
        });

        this._openai = new OpenAI({
            apiKey: opts.openaiKey ?? process.env.OPENAI_API_KEY,
        });

        // Build agent config from defaults + class fields
        const agentConfig: AgentConfig = {};

        // Apply defaults first
        if (this.defaults) {
            if (this.defaults.voice) agentConfig.voice = this.defaults.voice;
            if (this.defaults.language) agentConfig.language = this.defaults.language;
            if (this.defaults.stt) agentConfig.stt = this.defaults.stt;
            if (this.defaults.turnDetection) agentConfig.turnDetection = this.defaults.turnDetection;
            if (this.defaults.interruption !== undefined) agentConfig.interruption = this.defaults.interruption;
        }

        // Class fields override defaults
        if (this.voice) agentConfig.voice = this.voice;
        if (this.language) agentConfig.language = this.language;
        if (this.stt) agentConfig.stt = this.stt;
        if (this.turnDetection) agentConfig.turnDetection = this.turnDetection;
        if (this.interruption !== undefined) agentConfig.interruption = this.interruption;

        const agentId = this.constructor.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        this._agent = this._pc.agent(agentId, agentConfig);

        this._wireEvents();
    }

    // ── Public API ───────────────────────────────────────────────────────

    /** Add a phone channel. */
    addPhone(phone: string, config?: ChannelConfig): void {
        this._agent.addChannel("phone", phone, config);
    }

    /** Add any channel type. */
    addChannel(type: "phone" | "webrtc" | "mic", ref?: string, config?: ChannelConfig): void {
        this._agent.addChannel(type, ref, config);
    }

    /** Connect and start listening. */
    async start(): Promise<void> {
        // Collect all phones from phone + phones
        const allPhones: (string | Phone)[] = [];
        if (this.phone) allPhones.push(...(Array.isArray(this.phone) ? this.phone : [this.phone]));
        if (this.phones) allPhones.push(...this.phones);

        for (const p of allPhones) {
            if (typeof p === "string") {
                this._agent.addChannel("phone", p);
            } else {
                const config = p.toConfig();
                this._agent.addChannel("phone", p.number, Object.keys(config).length > 0 ? config : undefined);
            }
        }

        // Auto-add WebRTC channel
        if (this.webrtc) {
            const config = this.webrtc.toConfig();
            this._agent.addChannel("webrtc", undefined, Object.keys(config).length > 0 ? config : undefined);
        }

        // Auto-add generic channels
        if (this.channels) {
            for (const ch of this.channels) {
                const config = ch.toConfig();
                const ref = ch instanceof Phone ? (ch as Phone).number : undefined;
                this._agent.addChannel(ch.type, ref, Object.keys(config).length > 0 ? config : undefined);
            }
        }

        this._started = true;
        await this._pc.connect();
    }

    /** Disconnect. */
    async stop(): Promise<void> {
        this._started = false;
        await this._pc.disconnect();
    }

    /** Make an outbound call. */
    async dial(opts: { to: string; from: string; greeting?: string }): Promise<Call> {
        if (!this._started) await this.start();
        return this._agent.dial({
            to: opts.to,
            from: opts.from,
            greeting: opts.greeting ?? this.greeting,
        });
    }

    /** Access the underlying Pinecall agent (for raw events). */
    get agent(): Agent {
        return this._agent;
    }

    /** Access the underlying Pinecall connection. */
    get pinecall(): Pinecall {
        return this._pc;
    }

    /** Get conversation history for a call. */
    getHistory(callId: string): ConversationHistory | undefined {
        return this._histories.get(callId);
    }

    // ── Lifecycle hooks (override in subclass) ───────────────────────────

    /**
     * Called on each turn. Default implementation streams an OpenAI response
     * with tools. Override to use a different LLM or skip AI entirely.
     */
    async onTurn(turn: Turn, call: Call, history: ConversationHistory): Promise<void> {
        await this._streamOpenAIResponse(turn, call, history);
    }

    // ── Internal: channel greeting lookup ─────────────────────────────────

    /** Find a per-channel greeting for a call by matching call.to against Phone numbers. */
    private _greetingForCall(call: Call): string | undefined {
        // Collect all Phone instances
        const allPhones: Phone[] = [];
        if (this.phone instanceof Phone) allPhones.push(this.phone);
        if (this.phones) {
            for (const p of this.phones) {
                if (p instanceof Phone) allPhones.push(p);
            }
        }
        if (this.channels) {
            for (const ch of this.channels) {
                if (ch instanceof Phone) allPhones.push(ch);
            }
        }

        // Match call.to against phone numbers
        const match = allPhones.find(p => p.number && call.to === p.number);
        if (match?.greeting) return match.greeting;

        // Check WebRTC greeting (for non-phone calls)
        if (this.webrtc?.greeting) return this.webrtc.greeting;

        return undefined;
    }

    // ── Internal: event wiring ───────────────────────────────────────────

    private _wireEvents(): void {
        this._agent.on("call.started", (call) => {
            // Create per-call history
            const history = ConversationHistory.forCall(call, this.instructions);
            this._histories.set(call.id, history);

            // Auto-greeting: per-channel greeting takes priority over agent greeting
            const greeting = this._greetingForCall(call) ?? this.greeting;
            if (greeting) {
                call.say(greeting);
            }
        });

        this._agent.on("call.ended", (call) => {
            this._histories.delete(call.id);
        });

        // Wire turn event
        const turnEvent = this.turnEvent;
        this._agent.on(turnEvent, async (turn: Turn, call: Call) => {
            const history = this._histories.get(call.id);
            if (!history) return;

            try {
                await this.onTurn(turn, call, history);
            } catch (err) {
                console.error(`[GPTAgent] Error in onTurn:`, err);
                call.reply("Sorry, something went wrong. Please try again.");
            }
        });
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

        // Collect tool calls and text
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

            // Text content
            const token = choice.delta?.content;
            if (token) {
                stream.write(token);
                reply += token;
            }

            // Tool calls
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

        // If the model requested tool calls, execute them
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
        // Add assistant message with tool_calls to history
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

        // Execute each tool
        const Ctor = this.constructor as typeof GPTAgent;
        const toolDefs = Ctor._tools;

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

        // Second pass: get the final response after tool results
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
