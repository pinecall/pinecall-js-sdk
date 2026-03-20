/**
 * Agent — a logical voice agent within a Pinecall connection.
 *
 * Created via `pc.agent("my-agent", config?)`.
 * Each agent owns channels (phone, webrtc, mic) and receives events
 * independently from other agents on the same connection.
 *
 * @example
 * ```ts
 * const sales = pc.agent("sales-bot", {
 *   voice: "elevenlabs:abc",
 *   language: "es",
 * });
 * sales.addChannel("phone", "+19035551234");
 * sales.addChannel("webrtc");
 *
 * sales.on("call.started", (call) => {
 *   call.say("¡Hola!");
 * });
 * ```
 */

import { TypedEmitter } from "./utils/emitter.js";
import { Call, type Turn } from "./call.js";
import { forwardCallEvents } from "./utils/proxy.js";
import { buildShortcutPayload } from "./utils/protocol.js";
import type { SessionConfig } from "./types/config.js";
import type {
    CallStartedEvent,
    SpeechStartedEvent,
    SpeechEndedEvent,
    UserSpeakingEvent,
    UserMessageEvent,
    EagerTurnEvent,
    TurnPauseEvent,
    TurnEndEvent,
    TurnResumedEvent,
    TurnContinuedEvent,
    BotSpeakingEvent,
    BotWordEvent,
    BotFinishedEvent,
    BotInterruptedEvent,
    MessageConfirmedEvent,
    ReplyRejectedEvent,
    AudioMetricsEvent,
} from "./types/events.js";

// ─── Shortcut types ──────────────────────────────────────────────────────

/** Voice shortcut: "elevenlabs:voiceId" or full config object. */
export type VoiceShortcut = string | Record<string, unknown>;

/** STT shortcut: "deepgram" or full config object. */
export type STTShortcut = string | Record<string, unknown>;

/** Turn detection shortcut: "smart_turn" or full config object. */
export type TurnDetectionShortcut = string | Record<string, unknown>;

/** Interruption shortcut: false (disable) or config object. */
export type InterruptionShortcut = boolean | Record<string, unknown>;

// ─── Agent config ────────────────────────────────────────────────────────

export interface AgentConfig {
    voice?: VoiceShortcut;
    language?: string;
    stt?: STTShortcut;
    turnDetection?: TurnDetectionShortcut;
    interruption?: InterruptionShortcut;
    /** Server-side LLM: "openai:gpt-4.1-nano" or full config object. */
    llm?: string | Record<string, unknown>;
    config?: SessionConfig;
}

export interface ChannelConfig {
    voice?: VoiceShortcut;
    language?: string;
    stt?: STTShortcut;
    turnDetection?: TurnDetectionShortcut;
    interruption?: InterruptionShortcut;
    /** Server-side LLM: "openai:gpt-4.1-nano" or full config object. */
    llm?: string | Record<string, unknown>;
    config?: Partial<SessionConfig>;
}

// ─── Agent events ────────────────────────────────────────────────────────

export interface AgentEvents {
    [key: string]: (...args: any[]) => void;

    // Lifecycle
    ready: () => void;
    "call.started": (call: Call) => void;
    "call.ended": (call: Call, reason: string) => void;

    // Speech events
    "speech.started": (event: SpeechStartedEvent, call: Call) => void;
    "speech.ended": (event: SpeechEndedEvent, call: Call) => void;
    "user.speaking": (event: UserSpeakingEvent, call: Call) => void;
    "user.message": (event: UserMessageEvent, call: Call) => void;

    // Turn events
    "eager.turn": (turn: Turn, call: Call) => void;
    "turn.pause": (event: TurnPauseEvent, call: Call) => void;
    "turn.end": (turn: Turn, call: Call) => void;
    "turn.resumed": (event: TurnResumedEvent, call: Call) => void;
    "turn.continued": (event: TurnContinuedEvent, call: Call) => void;

    // Bot events
    "bot.speaking": (event: BotSpeakingEvent, call: Call) => void;
    "bot.word": (event: BotWordEvent, call: Call) => void;
    "bot.finished": (event: BotFinishedEvent, call: Call) => void;
    "bot.interrupted": (event: BotInterruptedEvent, call: Call) => void;

    // Confirmations
    "message.confirmed": (event: MessageConfirmedEvent, call: Call) => void;
    "reply.rejected": (event: ReplyRejectedEvent, call: Call) => void;

    // Analysis
    "audio.metrics": (event: AudioMetricsEvent, call: Call) => void;

    // Channel events
    "channel.added": (type: string, ref: string) => void;
    "channel.configured": (ref: string) => void;
    "channel.removed": (ref: string) => void;
}

// ─── Agent class ─────────────────────────────────────────────────────────

export class Agent extends TypedEmitter<AgentEvents> {
    readonly id: string;
    private _config: AgentConfig;
    private _calls = new Map<string, Call>();
    private _sendRaw: (data: Record<string, unknown>) => void;
    private _serverReady = false;
    private _pendingQueue: Record<string, unknown>[] = [];
    /** Tracks registered channels for re-registration on reconnect. */
    private _channels = new Map<string, { type: string; ref?: string; config?: ChannelConfig }>();

    /** @internal — created by Pinecall.agent() */
    constructor(
        id: string,
        config: AgentConfig,
        send: (data: Record<string, unknown>) => void,
    ) {
        super();
        this.id = id;
        this._config = config;
        this._sendRaw = send;
    }

    /**
     * Send a message — buffers if agent isn't server-ready yet.
     * Once _flushPending() is called, all buffered messages are sent.
     */
    private _send(data: Record<string, unknown>): void {
        if (this._serverReady) {
            this._sendRaw(data);
        } else {
            this._pendingQueue.push(data);
        }
    }

    // ── Public getters ───────────────────────────────────────────────────

    /** All active calls for this agent. */
    get calls(): ReadonlyMap<string, Call> {
        return this._calls;
    }

    /** Get a specific call by ID. */
    call(callId: string): Call | undefined {
        return this._calls.get(callId);
    }

    /** Get the current agent config. */
    getConfig(): AgentConfig {
        return this._config;
    }

    // ── Channel management ───────────────────────────────────────────────

    /**
     * Add a channel to this agent.
     *
     * @param type - "phone", "webrtc", or "mic"
     * @param ref - Phone number for phone, or optional ref for webrtc/mic
     * @param config - Optional config override for this channel
     *
     * @example
     * agent.addChannel("phone", "+19035551234");
     * agent.addChannel("phone", "+19035555678", { voice: "cartesia:uuid" });
     * agent.addChannel("webrtc");
     */
    addChannel(type: "phone" | "webrtc" | "mic", ref?: string, config?: ChannelConfig): void {
        // Validate phone numbers early
        if (type === "phone" && ref) {
            const cleaned = ref.replace(/[\s\-()]/g, "");
            const normalized = cleaned.startsWith("+") ? cleaned : "+" + cleaned;
            const digits = normalized.slice(1);
            if (!/^\d+$/.test(digits) || digits.length < 7 || digits.length > 15) {
                throw new Error(`Invalid phone number "${ref}": must be E.164 format (+, 7-15 digits)`);
            }
        }

        // Track for re-registration on reconnect
        const key = ref ?? type;
        this._channels.set(key, { type, ref, config });

        this._send({
            event: "channel.add",
            agent_id: this.id,
            type,
            ...(ref ? { ref } : {}),
            ...buildShortcutPayload(config),
        });
    }

    /**
     * Update config for an existing channel.
     *
     * @example agent.configureChannel("+19035551234", { voice: "cartesia:uuid" });
     */
    configureChannel(ref: string, config: ChannelConfig): void {
        this._send({
            event: "channel.configure",
            agent_id: this.id,
            ref,
            ...buildShortcutPayload(config),
        });
    }

    /**
     * Remove a channel from this agent.
     *
     * @example agent.removeChannel("+19035551234");
     */
    removeChannel(ref: string): void {
        this._channels.delete(ref);
        this._send({
            event: "channel.remove",
            agent_id: this.id,
            ref,
        });
    }

    // ── Agent configuration ──────────────────────────────────────────────

    /**
     * Update agent-wide defaults. Affects all future sessions.
     *
     * @example agent.configure({ voice: "elevenlabs:abc", language: "es" });
     */
    configure(opts: AgentConfig): void {
        this._config = { ...this._config, ...opts };
        this._send({
            event: "agent.configure",
            agent_id: this.id,
            ...buildShortcutPayload(opts),
        });
    }

    /**
     * Update config for an active session (mid-call).
     *
     * @example
     * agent.on("turn.end", (turn, call) => {
     *   agent.configureSession(call.id, { voice: "cartesia:uuid" });
     * });
     */
    configureSession(sessionId: string, opts: ChannelConfig): void {
        this._send({
            event: "session.configure",
            agent_id: this.id,
            session_id: sessionId,
            ...buildShortcutPayload(opts),
        });
    }

    // ── Dial ──────────────────────────────────────────────────────────────

    /**
     * Initiate an outbound call from this agent.
     *
     * @example
     * const call = await agent.dial({ to: "+1234567890", from: "+0987654321" });
     */
    dial(options: {
        to: string;
        from: string;
        greeting?: string;
        metadata?: Record<string, unknown>;
    }): Promise<Call> {
        return new Promise<Call>((resolve, reject) => {
            const cleanup = () => {
                this.off("call.started", onStarted);
                this.off("error" as any, onError);
            };
            const onStarted = (call: Call) => {
                if (call.to === options.to || call.direction === "outbound") {
                    cleanup();
                    resolve(call);
                }
            };
            const onError = (err: Error) => {
                cleanup();
                reject(err);
            };
            this.on("call.started", onStarted);
            this.on("error" as any, onError);

            this._send({
                event: "call.dial",
                agent_id: this.id,
                to: options.to,
                from: options.from,
                ...(options.greeting ? { greeting: options.greeting } : {}),
                ...(options.metadata ? { metadata: options.metadata } : {}),
            });

            setTimeout(() => {
                cleanup();
                reject(new Error("Dial timeout"));
            }, 30000);
        });
    }

    // ── Internal: event handling ──────────────────────────────────────────

    /** @internal Route a server event to this agent. */
    _handleEvent(data: Record<string, unknown>): void {
        const eventType = data.event as string;

        switch (eventType) {
            case "call.started": {
                const callId = data.call_id as string;
                const call = new Call(
                    {
                        call_id: callId,
                        from: (data.from as string) ?? "",
                        to: (data.to as string) ?? "",
                        direction: (data.direction as "inbound" | "outbound") ?? "inbound",
                        metadata: data.metadata as Record<string, unknown>,
                    },
                    (msg) => this._send({ ...msg, agent_id: this.id }),
                );
                this._calls.set(callId, call);
                this._proxyCallEvents(call);
                this.emit("call.started", call);
                break;
            }

            case "call.ended": {
                const callId = data.call_id as string;
                const call = this._calls.get(callId);
                if (call) {
                    call._end(data.reason as string);
                    this._calls.delete(callId);
                    this.emit("call.ended", call, data.reason as string);
                }
                break;
            }

            case "channel.added":
                this.emit("channel.added", data.type as string, data.ref as string);
                break;

            case "channel.configured":
                this.emit("channel.configured", data.ref as string);
                break;

            case "channel.removed":
                this.emit("channel.removed", data.ref as string);
                break;

            default: {
                // Route to call
                const callId = data.call_id as string;
                if (callId) {
                    let call = this._calls.get(callId);

                    // Auto-create call for server-side LLM events (WebRTC sessions
                    // don't send call.started via WebSocket, so _calls may be empty)
                    if (!call && eventType.startsWith("llm.")) {
                        call = new Call(
                            { call_id: callId, from: "", to: "", direction: "inbound" },
                            (msg: Record<string, unknown>) => this._send({ ...msg, agent_id: this.id }),
                        );
                        this._calls.set(callId, call);
                        this._proxyCallEvents(call);
                        // Emit call.started so greeting/hook handlers run for WebRTC sessions
                        this.emit("call.started", call);
                    }

                    if (call) {
                        call._handleEvent(data);
                        // Emit llm.* events on agent too — they aren't proxied
                        // from Call (unlike user.message, bot.speaking, etc.)
                        if (eventType.startsWith("llm.")) {
                            this.emit(eventType as any, call, data);
                        }
                    }
                }
                break;
            }
        }
    }

    /** @internal End all calls (on disconnect). */
    _endAllCalls(reason: string): void {
        for (const call of this._calls.values()) {
            call._end(reason);
        }
        this._calls.clear();
        // Reset server-ready so _flushPending re-runs on reconnect
        this._serverReady = false;
    }

    /** @internal Emit an event — used by Pinecall to trigger events on this agent. */
    _emit<K extends keyof AgentEvents>(event: K, ...args: Parameters<AgentEvents[K]>): void {
        this.emit(event, ...args);
    }

    /** @internal Mark agent as server-ready and flush buffered messages. */
    _flushPending(): void {
        this._serverReady = true;

        // Re-register all tracked channels (critical for reconnection)
        for (const [, ch] of this._channels) {
            this._sendRaw({
                event: "channel.add",
                agent_id: this.id,
                type: ch.type,
                ...(ch.ref ? { ref: ch.ref } : {}),
                ...buildShortcutPayload(ch.config),
            });
        }

        // Flush any other pending messages (skip channel.add — already handled above)
        for (const msg of this._pendingQueue) {
            if (msg.event === "channel.add") continue;
            this._sendRaw(msg);
        }
        this._pendingQueue = [];
    }

    /** @internal Proxy call events to agent level. */
    private _proxyCallEvents(call: Call): void {
        forwardCallEvents(call, this, call);
    }
}

// ── Re-export ────────────────────────────────────────────────────────────

// Re-export for backward compatibility (was originally defined here)
export { buildShortcutPayload } from "./utils/protocol.js";
