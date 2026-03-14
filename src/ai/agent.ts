/**
 * Agent — declarative voice agent base class.
 *
 * Handles Pinecall connection, channels (Phone, WebRTC),
 * per-call ConversationHistory, greetings, and the onTurn() hook.
 *
 * Extend this class and override onTurn() to plug in any LLM.
 * For OpenAI, use GPTAgent instead (extends Agent, adds OpenAI).
 *
 * @example
 * ```javascript
 * import { Agent, Phone } from "@pinecall/sdk/ai";
 *
 * class MyBot extends Agent {
 *     phone = new Phone("+13186330963");
 *     instructions = "You are helpful.";
 *
 *     async onTurn(turn, call, history) {
 *         call.reply("Hello!");
 *         history.addAssistant("Hello!");
 *     }
 * }
 *
 * export default MyBot;
 * ```
 */

import { Pinecall } from "../client.js";
import {
    Agent as CoreAgent,
    type AgentConfig,
    type ChannelConfig,
    type VoiceShortcut,
} from "../agent.js";
import { Call, type Turn } from "../call.js";
import { ConversationHistory } from "../history.js";
import { Channel, Phone, WebRTC } from "./channel.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface AgentOptions {
    /** Your Pinecall API key. */
    apiKey: string;
    /** WebSocket URL override. */
    url?: string;
}

// ─── Agent ───────────────────────────────────────────────────────────────

export class Agent {
    // ── Config fields (set in subclass) ──────────────────────────────────

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
    /** System prompt — seeded into ConversationHistory. */
    instructions = "You are a helpful voice assistant. Be concise.";
    /** Fallback greeting (channel greeting takes priority). */
    greeting?: string;
    /** Which turn event to respond on. Default: "eager.turn". */
    turnEvent: "eager.turn" | "turn.end" = "eager.turn";

    // ── Channel fields ───────────────────────────────────────────────────

    /** Single phone shortcut. */
    phone?: Phone;
    /** All channels (phones, WebRTC, etc.). */
    channels?: (Phone | WebRTC | Channel)[];

    // ── Internal ─────────────────────────────────────────────────────────

    /** @internal */
    protected _pc: Pinecall;
    /** @internal */
    protected _core: CoreAgent;
    /** @internal */
    protected _histories = new Map<string, ConversationHistory>();
    /** @internal — AbortController for the active LLM invocation per call. */
    private _turnAbort = new Map<string, AbortController>();
    /** @internal — turn_id currently being processed per call (dedup guard). */
    private _activeTurnId = new Map<string, number>();
    /** @internal */
    protected _started = false;

    // ── Constructor ──────────────────────────────────────────────────────

    constructor(opts: AgentOptions) {
        this._pc = new Pinecall({ apiKey: opts.apiKey, url: opts.url });

        // NOTE: We cannot read subclass field values here (e.g. this.stt, this.voice)
        // because in JavaScript, class field initializers on subclasses run *after*
        // super() returns. The agent config is built lazily in start() instead.
        const id = this.constructor.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
        this._core = this._pc.agent(id, {});

        this._wireEvents();
    }

    /** @internal Build AgentConfig from current field values (called in start()). */
    private _buildAgentConfig(): AgentConfig {
        const cfg: AgentConfig = {};
        if (this.voice) cfg.voice = this.voice;
        if (this.language) cfg.language = this.language;
        if (this.stt) cfg.stt = this.stt;
        if (this.turnDetection) cfg.turnDetection = this.turnDetection;
        if (this.interruption !== undefined) cfg.interruption = this.interruption;
        return cfg;
    }

    // ── Public API ───────────────────────────────────────────────────────

    /** Add a phone channel. */
    addPhone(phone: string, config?: ChannelConfig): void {
        this._core.addChannel("phone", phone, config);
    }

    /** Add any channel type. */
    addChannel(type: "phone" | "webrtc" | "mic", ref?: string, config?: ChannelConfig): void {
        this._core.addChannel(type, ref, config);
    }

    /** Connect and start listening. */
    async start(): Promise<void> {
        // Apply agent-level config now — subclass fields are fully initialized at this point.
        const agentCfg = this._buildAgentConfig();
        if (Object.keys(agentCfg).length > 0) {
            this._core.configure(agentCfg);
        }

        const all: Channel[] = [];
        if (this.phone) all.push(this.phone);
        if (this.channels) all.push(...this.channels);

        for (const ch of all) {
            const ref = ch instanceof Phone ? ch.number : undefined;
            const config = ch.toConfig();
            this._core.addChannel(ch.type, ref, Object.keys(config).length > 0 ? config : undefined);
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
        return this._core.dial({
            to: opts.to,
            from: opts.from,
            greeting: opts.greeting ?? this.greeting,
        });
    }

    /** Access the core Pinecall Agent (for raw event binding). */
    get core(): CoreAgent {
        return this._core;
    }

    /** Access the underlying Pinecall connection. */
    get pinecall(): Pinecall {
        return this._pc;
    }

    /** Get conversation history for a call. */
    getHistory(callId: string): ConversationHistory | undefined {
        return this._histories.get(callId);
    }

    /**
     * Log a message to the TUI LLM pane (or console if no TUI).
     * Use this instead of console.log inside tool functions.
     *
     * @example
     * async bookReservation({ date }, call) {
     *     this.log(call, `📅 Booking for ${date}`);
     *     return { confirmed: true };
     * }
     */
    log(call: Call, ...args: unknown[]): void {
        const msg = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
        this._core._emit("agent.log" as any, call, msg as any);
    }

    // ── Lifecycle hooks (override in subclass) ───────────────────────────

    /**
     * Called on each turn. Override to handle user speech.
     * @param signal — AbortSignal that fires when a newer turn supersedes this one.
     *                 Pass it to LLM/HTTP calls so they cancel immediately.
     */
    async onTurn(turn: Turn, call: Call, history: ConversationHistory, signal: AbortSignal): Promise<void> { }

    // ── Event hooks (override in subclass) ───────────────────────────────

    onCallStarted(call: Call): void { }
    onCallEnded(call: Call, reason: string): void { }
    onSpeechStarted(event: any, call: Call): void { }
    onSpeechEnded(event: any, call: Call): void { }
    onUserSpeaking(event: any, call: Call): void { }
    onUserMessage(event: any, call: Call): void { }
    onEagerTurn(turn: Turn, call: Call): void { }
    onTurnEnd(turn: Turn, call: Call): void { }
    onTurnPause(event: any, call: Call): void { }
    onTurnContinued(event: any, call: Call): void { }
    onTurnResumed(event: any, call: Call): void { }
    onBotSpeaking(event: any, call: Call): void { }
    onBotWord(event: any, call: Call): void { }
    onBotFinished(event: any, call: Call): void { }
    onBotInterrupted(event: any, call: Call): void { }
    onMessageConfirmed(event: any, call: Call): void { }
    onReplyRejected(event: any, call: Call): void { }
    onChannelAdded(type: string, ref: string): void { }

    // ── Internal ─────────────────────────────────────────────────────────

    /** @internal Abort and clean up LLM state for a call. */
    private _abortLLM(callId: string, call?: Call): void {
        const ac = this._turnAbort.get(callId);
        const turnId = this._activeTurnId.get(callId);
        if (ac) {
            if (call) this._core._emit("agent.log" as any, call, `⛔ _abortLLM turn_id=${turnId} aborted=${ac.signal.aborted}` as any);
            ac.abort();
        }
        this._turnAbort.delete(callId);
        this._activeTurnId.delete(callId);
    }

    /** @internal */
    protected _greetingForCall(call: Call): string | undefined {
        const all: Channel[] = [];
        if (this.phone) all.push(this.phone);
        if (this.channels) all.push(...this.channels);

        const match = all.find(ch => ch instanceof Phone && ch.number && call.to === ch.number) as Phone | undefined;
        if (match?.greeting) return match.greeting;

        const webrtc = all.find(ch => ch instanceof WebRTC) as WebRTC | undefined;
        if (webrtc?.greeting) return webrtc.greeting;

        return undefined;
    }

    /** @internal */
    private _wireEvents(): void {
        this._core.on("call.started", (call) => {
            const history = ConversationHistory.forCall(call, this.instructions);
            this._histories.set(call.id, history);

            const greeting = this._greetingForCall(call) ?? this.greeting;
            if (greeting) {
                call.say(greeting);
                history.addAssistant(greeting);
            }

            this.onCallStarted(call);
        });

        this._core.on("call.ended", (call, reason) => {
            this._abortLLM(call.id, call);
            this.onCallEnded(call, reason);
            this._histories.delete(call.id);
        });

        // Speech
        this._core.on("speech.started", (e, call) => this.onSpeechStarted(e, call));
        this._core.on("speech.ended", (e, call) => this.onSpeechEnded(e, call));
        this._core.on("user.speaking", (e, call) => this.onUserSpeaking(e, call));
        this._core.on("user.message", (e, call) => this.onUserMessage(e, call));

        // Turns
        this._core.on("eager.turn", (turn, call) => this.onEagerTurn(turn, call));
        this._core.on("turn.end", (turn, call) => this.onTurnEnd(turn, call));
        this._core.on("turn.pause", (e, call) => this.onTurnPause(e, call));
        this._core.on("turn.continued", (e, call) => {
            // Abort in-flight LLM when the user keeps speaking (turn continued)
            this._core._emit("agent.log" as any, call, `🔄 turn.continued → aborting LLM` as any);
            this._abortLLM(call.id, call);
            this.onTurnContinued(e, call);
        });
        this._core.on("turn.resumed", (e, call) => this.onTurnResumed(e, call));

        // Bot
        this._core.on("bot.speaking", (e, call) => this.onBotSpeaking(e, call));
        this._core.on("bot.word", (e, call) => this.onBotWord(e, call));
        this._core.on("bot.finished", (e, call) => this.onBotFinished(e, call));
        this._core.on("bot.interrupted", (e, call) => this.onBotInterrupted(e, call));

        // Confirmations
        this._core.on("message.confirmed", (e, call) => this.onMessageConfirmed(e, call));
        this._core.on("reply.rejected", (e, call) => this.onReplyRejected(e, call));

        // Channels
        this._core.on("channel.added", (type, ref) => this.onChannelAdded(type, ref));

        // ── onTurn handler: fire-and-forget with dedup + abort ───────────
        //
        // We do NOT await onTurn(). This lets new events process immediately.
        //
        // Dedup by turn_id: Flux can send multiple eager.turn events for the
        // SAME user utterance (same turn_id, refined text/probability). We
        // must NOT abort+restart for these — the first LLM call handles it.
        //
        // Only when a genuinely NEW turn arrives (different turn_id) do we
        // abort the previous LLM and start fresh. turn.continued and
        // call.ended also abort via _abortLLM().
        //
        const turnEvent = this.turnEvent;
        this._core.on(turnEvent, (turn: Turn, call: Call) => {
            const history = this._histories.get(call.id);
            if (!history) return;

            // ── Dedup: skip if LLM is already running for this exact turn ──
            if (this._activeTurnId.get(call.id) === turn.id) {
                this._core._emit("agent.log" as any, call, `⏭️ eager.turn DEDUP turn_id=${turn.id}` as any);
                return;
            }

            // ── New turn: abort any previous in-flight LLM ──
            this._core._emit("agent.log" as any, call, `🆕 eager.turn turn_id=${turn.id} text="${turn.text?.slice(0, 40)}"` as any);
            this._abortLLM(call.id, call);

            // Track this turn and create a fresh AbortController
            const ac = new AbortController();
            this._turnAbort.set(call.id, ac);
            this._activeTurnId.set(call.id, turn.id);

            // Fire-and-forget — do NOT await
            this.onTurn(turn, call, history, ac.signal)
                .catch((err) => {
                    // Aborted turns are expected — don't log or reply
                    if (ac.signal.aborted) return;
                    console.error(`[Agent] Error in onTurn:`, err);
                    call.reply("Sorry, something went wrong. Please try again.");
                })
                .finally(() => {
                    // Clean up only if this is still the active turn
                    // (a newer turn might have already replaced us)
                    if (this._activeTurnId.get(call.id) === turn.id) {
                        this._activeTurnId.delete(call.id);
                        this._turnAbort.delete(call.id);
                    }
                });
        });
    }
}
