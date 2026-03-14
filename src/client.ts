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
import { Agent } from "./agent.js";
import { buildShortcutPayload } from "./utils/protocol.js";
import { forwardAgentEvents } from "./utils/proxy.js";
import { appendFileSync } from "fs";
import type { AgentConfig, ChannelConfig, AgentEvents } from "./agent.js";
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

    // Agent-level events (proxied for single-agent convenience)
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

    // Protocol debug log
    private _logFile: string | null = process.env.PINECALL_LOG || null;

    // Connection state
    private _connectionId = "";
    private _orgId = "";
    private _protocolVersion = "";
    private _connected = false;

    // Agent registry
    private _agents = new Map<string, Agent>();

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

    // ── Instance API helpers (auto-inject apiKey) ─────────────────────────

    /** Fetch available TTS voices. */
    fetchVoices(opts?: Omit<FetchVoicesOptions, "apiKey">): Promise<Voice[]> {
        return _fetchVoices(opts);
    }

    /** Fetch phone numbers on your account. */
    fetchPhones(opts?: Omit<FetchPhonesOptions, "apiKey">): Promise<Phone[]> {
        return _fetchPhones({ ...opts, apiKey: this._opts.apiKey });
    }

    // ── Connect / Disconnect ─────────────────────────────────────────────

    /** Connect to the Pinecall server. Resolves when authenticated. */
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
        forwardAgentEvents(agent, this);

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
            this._send({
                event: "connect",
                api_key: this._opts.apiKey,
            });
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
                // End active calls and reset agent state for re-registration
                for (const agent of this._agents.values()) {
                    agent._endAllCalls("connection_lost");
                }
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
        this._log("←", data);
        const eventType = data.event as string;
        const agentId = data.agent_id as string | undefined;

        switch (eventType) {
            // ── Connected (auth success) ─────────────────────────────────
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
                        ...buildShortcutPayload(agent.getConfig()),
                    });
                }

                this._connectResolve?.();
                this._connectResolve = null;
                this._connectReject = null;
                this.emit("connected");
                break;

            // ── Agent lifecycle ──────────────────────────────────────────
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

            // ── Channel events ──────────────────────────────────────────
            case "channel.added":
            case "channel.configured":
            case "channel.removed": {
                const agent = agentId ? this._agents.get(agentId) : null;
                if (agent) agent._handleEvent(data);
                break;
            }

            // ── Call events → route to agent ────────────────────────────
            case "call.started":
            case "call.ended": {
                if (agentId) {
                    const agent = this._agents.get(agentId);
                    if (agent) agent._handleEvent(data);
                }
                break;
            }

            // ── Error ───────────────────────────────────────────────────
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

            // ── No-op events (expected, no action needed) ───────────────
            case "authenticated":
            case "pong":
            case "call.dialing":
            case "session.configured":
                // Expected protocol responses — no client-side action required
                break;

            // ── Displaced: another client registered same agent_id ──────
            case "agent.displaced":
                this._closing = true;
                this._stopPing();
                this._reconnector?.cancel();
                this._connected = false;
                this.emit(
                    "disconnected",
                    `displaced: ${(data.reason as string) ?? "replaced_by_new_connection"}`,
                );
                try { this._ws?.close(1000, "displaced"); } catch { /* ignore */ }
                break;

            // ── Call error ──────────────────────────────────────────────
            case "call.error": {
                const err = new PinecallError(
                    data.error as string,
                    (data.code as string) ?? "CALL_ERROR",
                );
                this.emit("error", err);
                break;
            }

            // ── All other call-scoped events → route to agent ───────────
            default: {
                // Debug: log tool call routing
                if (eventType === "llm.tool_call") {
                    console.log(`[Pinecall] 📨 llm.tool_call received, agent_id=${agentId}, agents=[${[...this._agents.keys()].join(",")}]`);
                }
                if (agentId) {
                    const agent = this._agents.get(agentId);
                    if (agent) agent._handleEvent(data);
                    else if (eventType === "llm.tool_call") {
                        console.error(`[Pinecall] ❌ No agent found for agent_id=${agentId}`);
                    }
                } else if (eventType === "llm.tool_call") {
                    console.error(`[Pinecall] ❌ llm.tool_call has no agent_id — event dropped!`);
                }
                break;
            }
        }
    }

    // ── Internal: send JSON ──────────────────────────────────────────────

    private _send(data: Record<string, unknown>): void {
        this._log("→", data);
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify(data));
        }
    }

    /** @internal Append to protocol log file if PINECALL_LOG is set. */
    private _log(dir: string, data: Record<string, unknown>): void {
        if (!this._logFile) return;
        const event = data.event as string;
        // Filter out noisy audio analysis events
        if (event === "audio.metrics" || event === "audio_analysis") return;
        const ts = new Date().toISOString();
        const line = `${ts} ${dir} ${JSON.stringify(data)}\n`;
        try { appendFileSync(this._logFile, line); } catch { /* ignore */ }
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
