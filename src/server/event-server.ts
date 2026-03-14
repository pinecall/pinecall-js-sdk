/**
 * EventServer — opt-in WebSocket server that broadcasts Agent/Call events.
 *
 * Usage:
 *   import { EventServer } from "@pinecall/sdk/server";
 *   const server = new EventServer({ port: 4100 });
 *   const token = server.attach(agent);   // Returns unique token
 *   server.start();
 *
 * Clients connect with token:
 *   new WebSocket("ws://localhost:4100", { headers: { Authorization: "Bearer <token>" } });
 *
 * Without tokens (requireAuth: false, default), all clients see all events.
 */

import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Agent } from "../agent.js";
import type { Call } from "../call.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface EventServerOptions {
    /** Port to listen on. Default: 4100 */
    port?: number;
    /** Host to bind to. Default: "127.0.0.1" (localhost only) */
    host?: string;
    /**
     * Require token auth for WS connections. Default: false.
     * When true, clients must pass `Authorization: Bearer <token>` header.
     * Tokens are returned by `attach()`.
     */
    requireAuth?: boolean;
    /**
     * Allowed origins for WebSocket connections.
     * When set, rejects connections from origins not in this list.
     */
    allowedOrigins?: string[];
}

// ── Events we forward ─────────────────────────────────────────────────────

const AGENT_EVENTS = [
    "call.started", "call.ended",
    "channel.added", "channel.removed",
] as const;

const CALL_EVENTS = [
    "speech.started", "speech.ended",
    "user.speaking", "user.message",
    "eager.turn", "turn.end", "turn.pause",
    "turn.continued", "turn.resumed",
    "bot.speaking", "bot.word", "bot.finished", "bot.interrupted",
    "message.confirmed", "reply.rejected",
] as const;

const LLM_EVENTS = [
    "llm.start", "llm.token", "llm.done",
    "llm.tool_call", "llm.tool_result",
] as const;

// ── Internals ────────────────────────────────────────────────────────────

/** Map token → set of agent IDs this token can access. */
type TokenStore = Map<string, Set<string>>;

/** Extended WebSocket with auth metadata. */
interface AuthedSocket extends WebSocket {
    _agentScope?: Set<string> | null;  // null = access all agents
}

// ── EventServer ──────────────────────────────────────────────────────────

export class EventServer {
    private _wss: WebSocketServer | null = null;
    private _port: number;
    private _host: string;
    private _agents: Set<Agent> = new Set();
    private _allowedOrigins: string[] | null;
    private _requireAuth: boolean;
    private _tokens: TokenStore = new Map();
    /** Reverse: agent id → token */
    private _agentTokens: Map<string, string> = new Map();

    constructor(opts: EventServerOptions = {}) {
        this._port = opts.port ?? 4100;
        this._host = opts.host ?? "127.0.0.1";
        this._allowedOrigins = opts.allowedOrigins ?? null;
        this._requireAuth = opts.requireAuth ?? false;
    }

    /** Number of connected WebSocket clients. */
    get clients(): number {
        return this._wss?.clients.size ?? 0;
    }

    /** Whether the server is running. */
    get listening(): boolean {
        return this._wss !== null;
    }

    /** Start the WebSocket server. */
    start(): void {
        if (this._wss) return;

        this._wss = new WebSocketServer({
            port: this._port,
            host: this._host,
            verifyClient: (info: { origin: string; req: IncomingMessage }, cb: (ok: boolean, code?: number, msg?: string) => void) => {
                // Origin check
                if (this._allowedOrigins && !this._allowedOrigins.includes(info.origin)) {
                    cb(false, 403, "Origin not allowed");
                    return;
                }

                // Token check
                if (this._requireAuth) {
                    const auth = info.req.headers["authorization"];
                    if (!auth || !auth.startsWith("Bearer ")) {
                        cb(false, 401, "Missing Authorization header");
                        return;
                    }
                    const token = auth.slice(7);
                    if (!this._tokens.has(token)) {
                        cb(false, 401, "Invalid token");
                        return;
                    }
                }

                cb(true);
            },
        });

        this._wss.on("connection", (ws: AuthedSocket, req: IncomingMessage) => {
            // Determine scope from token
            const auth = req.headers["authorization"];
            if (auth?.startsWith("Bearer ")) {
                const token = auth.slice(7);
                ws._agentScope = this._tokens.get(token) ?? null;
            } else {
                ws._agentScope = null; // no token = all agents (when auth not required)
            }

            // Send connection ack with visible agents
            const visibleAgents = ws._agentScope
                ? [...this._agents].filter(a => ws._agentScope!.has(a.id)).map(a => a.id)
                : [...this._agents].map(a => a.id);

            ws.send(JSON.stringify({
                event: "server.connected",
                agents: visibleAgents,
                port: this._port,
            }));

            // Bidirectional: handle commands from UI
            ws.on("message", (raw: Buffer | string) => {
                try {
                    const msg = JSON.parse(raw.toString());
                    this._handleCommand(msg, ws);
                } catch {
                    ws.send(JSON.stringify({ event: "error", message: "Invalid JSON" }));
                }
            });
        });
    }

    /** Stop the WebSocket server. */
    stop(): void {
        if (!this._wss) return;
        this._wss.close();
        this._wss = null;
    }

    /**
     * Attach an agent — all its events will be forwarded to WS clients.
     * Returns a unique token for this agent (use as `Authorization: Bearer <token>`).
     */
    attach(agent: Agent): string {
        // Reuse existing token if already attached
        if (this._agents.has(agent)) {
            return this._agentTokens.get(agent.id) ?? this._generateToken(agent);
        }

        const token = this._generateToken(agent);
        this._agents.add(agent);

        // ── Agent-level events ──
        for (const evt of AGENT_EVENTS) {
            agent.on(evt as any, (...args: any[]) => {
                const call = args.find((a: any) => a?.id && a?.from) as Call | undefined;
                this._broadcastScoped(agent.id, {
                    event: evt,
                    agent_id: agent.id,
                    ...(call ? { call_id: call.id, from: call.from, to: call.to, direction: call.direction } : {}),
                    ...this._extractEventData(evt, args),
                });
            });
        }

        // ── Call-level events ──
        for (const evt of CALL_EVENTS) {
            agent.on(evt as any, (...args: any[]) => {
                const eventData = args[0] ?? {};
                const call = args.find((a: any) => a?.id && a?.from) as Call | undefined;
                this._broadcastScoped(agent.id, {
                    event: evt,
                    agent_id: agent.id,
                    call_id: call?.id ?? "",
                    ...this._serializeEventData(eventData),
                });
            });
        }

        // ── LLM events ──
        for (const evt of LLM_EVENTS) {
            agent.on(evt as any, (...args: any[]) => {
                const call = args[0] as Call | undefined;
                const data = args[1] ?? {};
                this._broadcastScoped(agent.id, {
                    event: evt,
                    agent_id: agent.id,
                    call_id: call?.id ?? "",
                    ...this._serializeEventData(data),
                });
            });
        }

        return token;
    }

    /** Detach an agent — stop forwarding its events and revoke token. */
    detach(agent: Agent): void {
        this._agents.delete(agent);
        const token = this._agentTokens.get(agent.id);
        if (token) {
            const scope = this._tokens.get(token);
            if (scope) {
                scope.delete(agent.id);
                if (scope.size === 0) this._tokens.delete(token);
            }
            this._agentTokens.delete(agent.id);
        }
    }

    /**
     * Create a token that grants access to multiple agents at once.
     * Useful for dashboard UIs that need to see all agents.
     */
    createToken(...agents: Agent[]): string {
        const token = "evt_" + randomBytes(24).toString("hex");
        const scope = new Set<string>();
        for (const agent of agents) {
            scope.add(agent.id);
        }
        this._tokens.set(token, scope);
        return token;
    }

    /** Revoke a token. Connected clients using this token will stop receiving events. */
    revokeToken(token: string): void {
        this._tokens.delete(token);
    }

    // ── Internal ─────────────────────────────────────────────────────────

    private _generateToken(agent: Agent): string {
        // Check if agent already has a token
        const existing = this._agentTokens.get(agent.id);
        if (existing) {
            // Add to existing token scope
            const scope = this._tokens.get(existing);
            if (scope) scope.add(agent.id);
            return existing;
        }

        const token = "evt_" + randomBytes(24).toString("hex");
        const scope = new Set([agent.id]);
        this._tokens.set(token, scope);
        this._agentTokens.set(agent.id, token);
        return token;
    }

    /** Broadcast only to clients that have scope for this agent. */
    private _broadcastScoped(agentId: string, data: Record<string, unknown>): void {
        if (!this._wss || this._wss.clients.size === 0) return;
        const json = JSON.stringify(data);
        for (const client of this._wss.clients) {
            const authed = client as AuthedSocket;
            if (authed.readyState !== WebSocket.OPEN) continue;
            // null scope = sees everything (no auth mode)
            if (authed._agentScope === null || authed._agentScope === undefined) {
                authed.send(json);
            } else if (authed._agentScope.has(agentId)) {
                authed.send(json);
            }
        }
    }

    private _extractEventData(evt: string, args: any[]): Record<string, unknown> {
        if (evt === "call.started") {
            const call = args[0] as Call;
            return { from: call?.from, to: call?.to, direction: call?.direction };
        }
        if (evt === "call.ended") {
            const reason = args[1] as string;
            return { reason };
        }
        if (evt === "channel.added") {
            return { type: args[0], ref: args[1] };
        }
        return {};
    }

    private _serializeEventData(data: any): Record<string, unknown> {
        if (!data || typeof data !== "object") return {};
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === "function") continue;
            if (key.startsWith("_")) continue;
            result[key] = value;
        }
        return result;
    }

    // ── Bidirectional commands ────────────────────────────────────────────

    private _findAgent(agentId: string): Agent | undefined {
        for (const agent of this._agents) {
            if (agent.id === agentId) return agent;
        }
        const lower = agentId.toLowerCase();
        for (const agent of this._agents) {
            if (agent.id.toLowerCase().startsWith(lower)) return agent;
        }
        return undefined;
    }

    private _findCall(callId: string): { agent: Agent; call: Call } | undefined {
        for (const agent of this._agents) {
            for (const [id, call] of agent.calls) {
                if (id === callId || id.startsWith(callId)) {
                    return { agent, call };
                }
            }
        }
        return undefined;
    }

    /** Check if socket has scope for an agent. */
    private _hasScope(ws: AuthedSocket, agentId: string): boolean {
        if (ws._agentScope === null || ws._agentScope === undefined) return true;
        return ws._agentScope.has(agentId);
    }

    private _handleCommand(msg: any, ws: AuthedSocket): void {
        const reply = (data: Record<string, unknown>) => {
            ws.send(JSON.stringify(data));
        };

        switch (msg.action) {
            case "dial": {
                const agent = this._findAgent(msg.agent_id);
                if (!agent) {
                    reply({ event: "error", action: "dial", message: `Agent not found: ${msg.agent_id}` });
                    return;
                }
                if (!this._hasScope(ws, agent.id)) {
                    reply({ event: "error", action: "dial", message: "Permission denied" });
                    return;
                }
                if (!msg.to || !msg.from) {
                    reply({ event: "error", action: "dial", message: "Missing 'to' or 'from'" });
                    return;
                }
                agent.dial({
                    to: msg.to,
                    from: msg.from,
                    greeting: msg.greeting,
                    metadata: msg.metadata,
                });
                reply({ event: "action.ok", action: "dial", agent_id: agent.id, to: msg.to });
                break;
            }

            case "hangup": {
                const found = this._findCall(msg.call_id);
                if (!found) {
                    reply({ event: "error", action: "hangup", message: `Call not found: ${msg.call_id}` });
                    return;
                }
                if (!this._hasScope(ws, found.agent.id)) {
                    reply({ event: "error", action: "hangup", message: "Permission denied" });
                    return;
                }
                found.call.hangup();
                reply({ event: "action.ok", action: "hangup", call_id: found.call.id });
                break;
            }

            case "configure": {
                const found = this._findCall(msg.call_id);
                if (!found) {
                    reply({ event: "error", action: "configure", message: `Call not found: ${msg.call_id}` });
                    return;
                }
                if (!this._hasScope(ws, found.agent.id)) {
                    reply({ event: "error", action: "configure", message: "Permission denied" });
                    return;
                }
                const { call_id: _, action: __, ...config } = msg;
                found.call.configure(config);
                reply({ event: "action.ok", action: "configure", call_id: found.call.id });
                break;
            }

            case "agents": {
                // Only return agents within scope
                const visible = [...this._agents].filter(a => this._hasScope(ws, a.id));
                reply({
                    event: "agents.list",
                    agents: visible.map(a => ({
                        id: a.id,
                        channels: [...((a as any)._channels || new Map())].map(([ref]: [string]) => ref),
                        calls: [...a.calls.keys()],
                    })),
                });
                break;
            }

            case "calls": {
                const calls: any[] = [];
                for (const agent of this._agents) {
                    if (!this._hasScope(ws, agent.id)) continue;
                    for (const [id, call] of agent.calls) {
                        calls.push({
                            call_id: id,
                            agent_id: agent.id,
                            from: call.from,
                            to: call.to,
                            direction: call.direction,
                        });
                    }
                }
                reply({ event: "calls.list", calls });
                break;
            }

            default:
                reply({ event: "error", message: `Unknown action: ${msg.action}` });
        }
    }
}
