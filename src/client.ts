/**
 * Pinecall — connection manager.
 *
 * Manages the WebSocket connection, handles auth, reconnection, ping/pong,
 * and multiplexes events to Agent instances.
 *
 * Usage:
 *   const pc = new Pinecall({ apiKey: "pk_..." });
 *   await pc.connect();
 *
 *   const sales = pc.agent("sales-bot", { voice: "elevenlabs:abc" });
 *   sales.addChannel("phone", "+19035551234");
 *   sales.on("call.started", (call) => call.say("Hello!"));
 */

import { TypedEmitter } from "./utils/emitter.js";
import { Reconnector, type ReconnectOptions } from "./utils/reconnect.js";
import { Call, type Turn } from "./call.js";
import { Agent, buildShortcutPayload } from "./agent.js";
import type { AgentConfig, ChannelConfig, AgentEvents } from "./agent.js";
import type { SessionConfig } from "./types/config.js";
import {
    fetchVoices as _fetchVoices,
    fetchPhones as _fetchPhones,
    type Voice,
    type Phone,
    type FetchVoicesOptions,
    type FetchPhonesOptions,
} from "./api.js";
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

// Re-export shortcut types from agent
export type {
    VoiceShortcut,
    STTShortcut,
    TurnDetectionShortcut,
    InterruptionShortcut,
    AgentConfig,
    ChannelConfig,
} from "./agent.js";

// ─── Event map ───────────────────────────────────────────────────────────

export interface PinecallEvents {
    [key: string]: (...args: any[]) => void;
    // Connection lifecycle
    connected: () => void;
    disconnected: (reason: string) => void;
    reconnecting: (attempt: number) => void;
    error: (error: PinecallError) => void;

    // Agent-level events (for single-agent backward compat)
    "call.started": (call: Call) => void;
    "call.ended": (call: Call, reason: string) => void;
    "speech.started": (event: SpeechStartedEvent, call: Call) => void;
    "speech.ended": (event: SpeechEndedEvent, call: Call) => void;
    "user.speaking": (event: UserSpeakingEvent, call: Call) => void;
    "user.message": (event: UserMessageEvent, call: Call) => void;
    "eager.turn": (turn: Turn, call: Call) => void;
    "turn.pause": (event: TurnPauseEvent, call: Call) => void;
    "turn.end": (turn: Turn, call: Call) => void;
    "turn.resumed": (event: TurnResumedEvent, call: Call) => void;
    "turn.continued": (event: TurnContinuedEvent, call: Call) => void;
    "bot.speaking": (event: BotSpeakingEvent, call: Call) => void;
    "bot.word": (event: BotWordEvent, call: Call) => void;
    "bot.finished": (event: BotFinishedEvent, call: Call) => void;
    "bot.interrupted": (event: BotInterruptedEvent, call: Call) => void;
    "message.confirmed": (event: MessageConfirmedEvent, call: Call) => void;
    "reply.rejected": (event: ReplyRejectedEvent, call: Call) => void;
    "audio.metrics": (event: AudioMetricsEvent, call: Call) => void;
}

// ─── Options ─────────────────────────────────────────────────────────────

export interface PinecallOptions {
    /** Your Pinecall API key. */
    apiKey: string;

    /** WebSocket URL. Default: "wss://voice.pinecall.io/client" */
    url?: string;

    /** Reconnection. true = defaults, false = disabled, or custom options. */
    reconnect?: boolean | ReconnectOptions;

    /** Ping interval in ms. Default: 30000. Set 0 to disable. */
    pingInterval?: number;

    /**
     * Force legacy v1 protocol (single-agent, monolithic register).
     * When true, Pinecall acts as both connection AND agent.
     */
    legacyProtocol?: boolean;

    // ── Legacy single-agent shortcuts (v1 compat) ─────────────────────

    /** @deprecated Use `pc.agent(id, config)` instead. */
    appId?: string;
    /** @deprecated Use `pc.agent(id, config)` instead. */
    agentId?: string;
    /** @deprecated Use agent shortcuts. */
    config?: SessionConfig;
    /** @deprecated Use agent `addChannel()`. */
    phones?: Record<string, Partial<SessionConfig>>;
    /** @deprecated Use agent shortcuts. */
    mode?: "twilio" | "websocket" | "webrtc";
}

// ─── Error class ─────────────────────────────────────────────────────────

export class PinecallError extends Error {
    readonly code: string;

    constructor(message: string, code = "UNKNOWN") {
        super(message);
        this.name = "PinecallError";
        this.code = code;
    }
}

// ─── Pinecall client ─────────────────────────────────────────────────────

export class Pinecall extends TypedEmitter<PinecallEvents> {
    private _opts: PinecallOptions;
    private _ws: WebSocket | null = null;
    private _reconnector: Reconnector | null = null;
    private _pingTimer: ReturnType<typeof setInterval> | null = null;
    private _closing = false;

    // Connection state
    private _connectionId = "";
    private _orgId = "";
    private _protocolVersion = "";
    private _connected = false;

    // Multi-agent registry
    private _agents = new Map<string, Agent>();

    // Legacy single-agent compat
    private _defaultAgent: Agent | null = null;
    private _calls = new Map<string, Call>();
    private _appId = "";

    // Registration promise
    private _connectResolve: (() => void) | null = null;
    private _connectReject: ((err: Error) => void) | null = null;

    constructor(options: PinecallOptions) {
        super();
        this._opts = options;

        const reconnectOpt = options.reconnect ?? true;
        if (reconnectOpt) {
            const opts =
                typeof reconnectOpt === "object" ? reconnectOpt : undefined;
            this._reconnector = new Reconnector(opts);
        }
    }

    // ── Public getters ───────────────────────────────────────────────────

    get connected(): boolean {
        return this._connected;
    }

    get connectionId(): string {
        return this._connectionId;
    }

    get orgId(): string {
        return this._orgId;
    }

    get protocolVersion(): string {
        return this._protocolVersion;
    }

    /** @deprecated Use `agent()` to get agents. */
    get appId(): string {
        return this._appId;
    }

    /** @deprecated Use `agent.call()` or `agent.calls`. */
    call(callId: string): Call | undefined {
        return this._calls.get(callId);
    }

    /** @deprecated Use `agent.calls`. */
    get calls(): ReadonlyMap<string, Call> {
        return this._calls;
    }

    /** All agents on this connection. */
    get agents(): ReadonlyMap<string, Agent> {
        return this._agents;
    }

    // ── Static API helpers ────────────────────────────────────────────────

    static fetchVoices(opts?: FetchVoicesOptions): Promise<Voice[]> {
        return _fetchVoices(opts);
    }

    static fetchPhones(opts: FetchPhonesOptions): Promise<Phone[]> {
        return _fetchPhones(opts);
    }

    // ── Connect / Disconnect ─────────────────────────────────────────────

    /**
     * Connect to the Pinecall server.
     * For v2: resolves when WebSocket is authenticated.
     * For legacy: resolves when `registered` is received.
     */
    connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this._connectResolve = resolve;
            this._connectReject = reject;
            this._closing = false;
            this._openSocket();
        });
    }

    /** Gracefully disconnect. */
    async disconnect(): Promise<void> {
        this._closing = true;
        this._stopPing();
        this._reconnector?.cancel();

        if (this._ws) {
            this._ws.close(1000, "client_disconnect");
            this._ws = null;
        }

        // End all calls across all agents
        for (const agent of this._agents.values()) {
            agent._endAllCalls("disconnected");
        }
        for (const call of this._calls.values()) {
            call._end("disconnected");
        }
        this._calls.clear();
        this._connected = false;
    }

    // ── Agent factory ────────────────────────────────────────────────────

    /**
     * Create or get an agent on this connection.
     *
     * @param id - Agent ID (slug). Must be unique within your org.
     * @param config - Optional initial config (voice, language, stt, etc.)
     *
     * @example
     * const sales = pc.agent("sales-bot", {
     *   voice: "elevenlabs:abc",
     *   language: "es",
     * });
     * sales.addChannel("phone", "+19035551234");
     * sales.addChannel("webrtc");
     *
     * sales.on("call.started", (call) => call.say("¡Hola!"));
     */
    agent(id: string, config?: AgentConfig): Agent {
        // Return existing if already created
        let existing = this._agents.get(id);
        if (existing) {
            if (config) existing.configure(config);
            return existing;
        }

        const agent = new Agent(id, config ?? {}, (data) => this._send(data));
        this._agents.set(id, agent);

        // Proxy agent events to connection level for convenience
        this._proxyAgentEvents(agent);

        // If connected, send agent.create immediately
        if (this._connected) {
            this._send({
                event: "agent.create",
                agent_id: id,
                ...buildShortcutPayload(config),
            });
        }

        return agent;
    }

    // ── Legacy compat methods ────────────────────────────────────────────

    /** @deprecated Use `agent.addChannel("phone", ...)`. */
    addPhone(phone: string, config?: Partial<SessionConfig>): void {
        this._send({ event: "add_phone", phone, ...(config ? { config } : {}) });
    }

    /** @deprecated Use `agent.removeChannel(phone)`. */
    removePhone(phone: string): void {
        this._send({ event: "remove_phone", phone });
    }

    /** @deprecated Use `agent.configure()`. */
    updateConfig(config: Partial<SessionConfig>, phone?: string): void {
        this._send({
            event: "update_config",
            config,
            ...(phone ? { phone } : {}),
        });
    }

    /** @deprecated Use `agent.dial()`. */
    dial(options: {
        to: string;
        from: string;
        greeting?: string;
        metadata?: Record<string, unknown>;
    }): Promise<Call> {
        return new Promise<Call>((resolve, reject) => {
            const onStarted = (call: Call) => {
                if (call.to === options.to || call.direction === "outbound") {
                    this.off("call.started", onStarted);
                    this.off("error", onError);
                    resolve(call);
                }
            };
            const onError = (err: PinecallError) => {
                this.off("call.started", onStarted);
                this.off("error", onError);
                reject(err);
            };
            this.on("call.started", onStarted);
            this.on("error", onError);

            this._send({
                event: "call.dial",
                to: options.to,
                from: options.from,
                ...(options.greeting ? { greeting: options.greeting } : {}),
                ...(options.metadata ? { metadata: options.metadata } : {}),
            });

            setTimeout(() => {
                this.off("call.started", onStarted);
                this.off("error", onError);
                reject(new PinecallError("Dial timeout", "TIMEOUT"));
            }, 30000);
        });
    }

    // ── Internal: WebSocket lifecycle ────────────────────────────────────

    private _openSocket(): void {
        const url = this._opts.url ?? "wss://voice.pinecall.io/client";

        try {
            this._ws = new WebSocket(url);
        } catch (err) {
            const error = new PinecallError(
                `Failed to create WebSocket: ${err}`,
                "CONNECTION_FAILED",
            );
            this._connectReject?.(error);
            this.emit("error", error);
            return;
        }

        const connectTimeout = setTimeout(() => {
            if (!this._connected && this._connectReject) {
                const error = new PinecallError(
                    `Connection timeout: could not reach ${url}`,
                    "CONNECTION_TIMEOUT",
                );
                this._connectReject(error);
                this._connectResolve = null;
                this._connectReject = null;
                this.emit("error", error);
                try { this._ws?.close(); } catch { /* ignore */ }
            }
        }, 10000);

        this._ws.onopen = () => {
            clearTimeout(connectTimeout);

            if (this._opts.legacyProtocol) {
                // Legacy v1: monolithic register
                this._send({
                    event: "register",
                    api_key: this._opts.apiKey,
                    ...(this._opts.appId || this._opts.agentId
                        ? { app_id: this._opts.agentId ?? this._opts.appId }
                        : {}),
                    ...(this._opts.mode ? { mode: this._opts.mode } : {}),
                    ...(this._opts.config ? { config: this._opts.config } : {}),
                    ...(this._opts.phones ? { phones: this._opts.phones } : {}),
                });
            } else {
                // Protocol v2: auth-only connect
                this._send({
                    event: "connect",
                    api_key: this._opts.apiKey,
                });
            }
        };

        this._ws.onmessage = (evt: MessageEvent) => {
            try {
                const data = JSON.parse(
                    typeof evt.data === "string" ? evt.data : "",
                ) as Record<string, unknown>;
                this._onMessage(data);
            } catch {
                // Ignore non-JSON messages
            }
        };

        this._ws.onclose = (evt: CloseEvent) => {
            clearTimeout(connectTimeout);
            this._connected = false;
            this._stopPing();

            if (this._closing) {
                this.emit("disconnected", "client_disconnect");
                return;
            }

            const reason = evt.reason || "connection_lost";
            this.emit("disconnected", reason);

            if (this._reconnector) {
                this._attemptReconnect().catch(() => {
                    this._connectReject?.(
                        new PinecallError("Reconnection failed", "CONNECTION_FAILED"),
                    );
                    this._connectResolve = null;
                    this._connectReject = null;
                });
            } else {
                this._connectReject?.(
                    new PinecallError(`Connection lost: ${reason}`, "CONNECTION_FAILED"),
                );
                this._connectResolve = null;
                this._connectReject = null;
            }
        };

        this._ws.onerror = () => {
            // onclose will fire after this
        };
    }

    private async _attemptReconnect(): Promise<void> {
        if (this._closing || !this._reconnector) return;

        while (!this._closing) {
            const attempt = this._reconnector.attempt + 1;
            this.emit("reconnecting", attempt);

            await this._reconnector.wait();

            if (this._closing) return;

            try {
                await new Promise<void>((resolve, reject) => {
                    this._connectResolve = resolve;
                    this._connectReject = reject;
                    this._openSocket();

                    setTimeout(() => {
                        if (!this._connected) {
                            reject(new PinecallError("Reconnect timeout", "TIMEOUT"));
                        }
                    }, 10000);
                });
                this._reconnector.reset();
                return;
            } catch {
                continue;
            }
        }
    }

    // ── Internal: message routing ────────────────────────────────────────

    private _onMessage(data: Record<string, unknown>): void {
        const eventType = data.event as string;
        const agentId = data.agent_id as string | undefined;

        switch (eventType) {
            // ── Protocol v2: connected ───────────────────────────────────
            case "connected":
                this._connectionId = (data.connection_id as string) ?? "";
                this._orgId = (data.org_id as string) ?? "";
                this._protocolVersion = (data.protocol_version as string) ?? "";
                this._connected = true;
                this._startPing();

                // Send pending agent.create for all pre-registered agents
                for (const [id, agent] of this._agents) {
                    this._send({
                        event: "agent.create",
                        agent_id: id,
                        ...buildShortcutPayload((agent as any)._config),
                    });
                }

                this._connectResolve?.();
                this._connectResolve = null;
                this._connectReject = null;
                this.emit("connected");
                break;

            // ── Agent lifecycle events (route to agent) ──────────────────
            case "agent.created":
            case "agent.configured":
            case "agent.resumed": {
                const agent = this._agents.get(agentId ?? "");
                if (agent && (eventType === "agent.created" || eventType === "agent.resumed")) {
                    agent._flushPending();
                    agent._emit("ready");
                }
                break;
            }
            // ── Channel events (route to agent) ──────────────────────────
            case "channel.added":
            case "channel.configured":
            case "channel.removed": {
                const agent = agentId ? this._agents.get(agentId) : null;
                if (agent) {
                    agent._handleEvent(data);
                }
                break;
            }

            // ── Call events (route to agent) ─────────────────────────────
            case "call.started":
            case "session.started":
            case "call.ended":
            case "session.ended": {
                if (agentId) {
                    const agent = this._agents.get(agentId);
                    if (agent) {
                        agent._handleEvent(data);
                        break;
                    }
                }
                // Fallback: legacy single-agent — handle directly
                this._handleLegacyCallEvent(data, eventType);
                break;
            }

            // ── Legacy v1: registered ────────────────────────────────────
            case "registered":
                this._appId = data.app_id as string;
                this._protocolVersion = (data.protocol_version as string) ?? "";
                this._connected = true;
                this._startPing();
                this._connectResolve?.();
                this._connectResolve = null;
                this._connectReject = null;
                this.emit("connected");
                break;

            case "error": {
                const err = new PinecallError(
                    data.error as string,
                    (data.code as string) ?? "UNKNOWN",
                );
                this._connectReject?.(err);
                this._connectResolve = null;
                this._connectReject = null;
                this.emit("error", err);
                break;
            }

            case "authenticated":
            case "pong":
                break;

            case "call.dialing":
                break;

            case "call.error": {
                const err = new PinecallError(
                    data.error as string,
                    (data.code as string) ?? "CALL_ERROR",
                );
                this.emit("error", err);
                break;
            }

            // Legacy ack events
            case "config_updated":
            case "session_config_updated":
            case "phone_added":
            case "phone_removed":
            case "session.configured":
                break;

            // All other call-scoped events — try agent routing first
            default: {
                if (agentId) {
                    const agent = this._agents.get(agentId);
                    if (agent) {
                        agent._handleEvent(data);
                        break;
                    }
                }
                // Fallback to legacy call routing
                const callId = (data.call_id ?? data.session_id) as string;
                if (callId) {
                    const call = this._calls.get(callId);
                    if (call) {
                        call._handleEvent(data);
                    }
                }
                break;
            }
        }
    }

    /** Handle call events for legacy single-agent mode. */
    private _handleLegacyCallEvent(data: Record<string, unknown>, eventType: string): void {
        if (eventType === "call.started" || eventType === "session.started") {
            const callId = (data.call_id ?? data.session_id) as string;
            const call = new Call(
                {
                    call_id: callId,
                    from: (data.from as string) ?? "",
                    to: (data.to as string) ?? "",
                    direction: (data.direction as "inbound" | "outbound") ?? "inbound",
                    metadata: data.metadata as Record<string, unknown>,
                },
                (msg) => this._send(msg),
            );
            this._calls.set(callId, call);
            this._proxyCallEvents(call);
            this.emit("call.started", call);
        } else if (eventType === "call.ended" || eventType === "session.ended") {
            const callId = (data.call_id ?? data.session_id) as string;
            const call = this._calls.get(callId);
            if (call) {
                call._end(data.reason as string);
                this._calls.delete(callId);
                this.emit("call.ended", call, data.reason as string);
            }
        }
    }

    /**
     * Proxy agent events to connection-level for backward compat.
     * So `pc.on("call.started")` still works when there's one agent.
     */
    private _proxyAgentEvents(agent: Agent): void {
        agent.on("call.started", (call) => this.emit("call.started", call));
        agent.on("call.ended", (call, reason) => this.emit("call.ended", call, reason));
        agent.on("speech.started", (e, c) => this.emit("speech.started", e, c));
        agent.on("speech.ended", (e, c) => this.emit("speech.ended", e, c));
        agent.on("user.speaking", (e, c) => this.emit("user.speaking", e, c));
        agent.on("user.message", (e, c) => this.emit("user.message", e, c));
        agent.on("eager.turn", (t, c) => this.emit("eager.turn", t, c));
        agent.on("turn.pause", (e, c) => this.emit("turn.pause", e, c));
        agent.on("turn.end", (t, c) => this.emit("turn.end", t, c));
        agent.on("turn.resumed", (e, c) => this.emit("turn.resumed", e, c));
        agent.on("turn.continued", (e, c) => this.emit("turn.continued", e, c));
        agent.on("bot.speaking", (e, c) => this.emit("bot.speaking", e, c));
        agent.on("bot.word", (e, c) => this.emit("bot.word", e, c));
        agent.on("bot.finished", (e, c) => this.emit("bot.finished", e, c));
        agent.on("bot.interrupted", (e, c) => this.emit("bot.interrupted", e, c));
        agent.on("message.confirmed", (e, c) => this.emit("message.confirmed", e, c));
        agent.on("reply.rejected", (e, c) => this.emit("reply.rejected", e, c));
        agent.on("audio.metrics", (e, c) => this.emit("audio.metrics", e, c));
    }

    /** Legacy: proxy call events to connection level. */
    private _proxyCallEvents(call: Call): void {
        call.on("speech.started", (e) => this.emit("speech.started", e, call));
        call.on("speech.ended", (e) => this.emit("speech.ended", e, call));
        call.on("user.speaking", (e) => this.emit("user.speaking", e, call));
        call.on("user.message", (e) => this.emit("user.message", e, call));
        call.on("eager.turn", (turn) => this.emit("eager.turn", turn, call));
        call.on("turn.pause", (e) => this.emit("turn.pause", e, call));
        call.on("turn.end", (turn) => this.emit("turn.end", turn, call));
        call.on("turn.resumed", (e) => this.emit("turn.resumed", e, call));
        call.on("turn.continued", (e) => this.emit("turn.continued", e, call));
        call.on("bot.speaking", (e) => this.emit("bot.speaking", e, call));
        call.on("bot.word", (e) => this.emit("bot.word", e, call));
        call.on("bot.finished", (e) => this.emit("bot.finished", e, call));
        call.on("bot.interrupted", (e) => this.emit("bot.interrupted", e, call));
        call.on("message.confirmed", (e) => this.emit("message.confirmed", e, call));
        call.on("reply.rejected", (e) => this.emit("reply.rejected", e, call));
        call.on("audio.metrics", (e) => this.emit("audio.metrics", e, call));
    }

    // ── Internal: send JSON ──────────────────────────────────────────────

    private _send(data: Record<string, unknown>): void {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify(data));
        }
    }

    // ── Internal: ping/pong ──────────────────────────────────────────────

    private _startPing(): void {
        this._stopPing();
        const interval = this._opts.pingInterval ?? 30000;
        if (interval <= 0) return;

        this._pingTimer = setInterval(() => {
            this._send({ event: "ping" });
        }, interval);
    }

    private _stopPing(): void {
        if (this._pingTimer) {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
        }
    }
}
