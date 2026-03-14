/**
 * EventServer — opt-in WebSocket server that broadcasts Agent/Call events.
 *
 * Usage:
 *   import { EventServer } from "@pinecall/sdk/server";
 *   const server = new EventServer({ port: 4100 });
 *   server.attach(agent);          // Subscribe to all events
 *   server.start();                // Start listening
 *   // ... later
 *   server.stop();
 *
 * Any WebSocket client connects to ws://localhost:4100 and receives
 * JSON events:
 *   { "event": "call.started", "call_id": "CA...", "from": "+1...", "to": "+1...", ... }
 *   { "event": "user.message", "call_id": "CA...", "text": "Hello", ... }
 *   { "event": "llm.token",   "call_id": "CA...", "token": "Hi", ... }
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Agent } from "../agent.js";
import type { Call } from "../call.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface EventServerOptions {
    /** Port to listen on. Default: 4100 */
    port?: number;
    /** Host to bind to. Default: "127.0.0.1" (localhost only) */
    host?: string;
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

// ── EventServer ──────────────────────────────────────────────────────────

export class EventServer {
    private _wss: WebSocketServer | null = null;
    private _port: number;
    private _host: string;
    private _agents: Set<Agent> = new Set();

    constructor(opts: EventServerOptions = {}) {
        this._port = opts.port ?? 4100;
        this._host = opts.host ?? "127.0.0.1";
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
        });

        this._wss.on("connection", (ws: WebSocket) => {
            // Send current state snapshot
            ws.send(JSON.stringify({
                event: "server.connected",
                agents: [...this._agents].map(a => a.id),
                port: this._port,
            }));
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
     */
    attach(agent: Agent): void {
        if (this._agents.has(agent)) return;
        this._agents.add(agent);

        // ── Agent-level events ──
        for (const evt of AGENT_EVENTS) {
            agent.on(evt as any, (...args: any[]) => {
                const call = args.find((a: any) => a?.id && a?.from) as Call | undefined;
                this._broadcast({
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
                this._broadcast({
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
                this._broadcast({
                    event: evt,
                    agent_id: agent.id,
                    call_id: call?.id ?? "",
                    ...this._serializeEventData(data),
                });
            });
        }
    }

    /** Detach an agent — stop forwarding its events. */
    detach(agent: Agent): void {
        this._agents.delete(agent);
    }

    // ── Internal ─────────────────────────────────────────────────────────

    private _broadcast(data: Record<string, unknown>): void {
        if (!this._wss || this._wss.clients.size === 0) return;
        const json = JSON.stringify(data);
        for (const client of this._wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(json);
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
        // Filter out non-serializable fields
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
            if (typeof value === "function") continue;
            if (key.startsWith("_")) continue;
            result[key] = value;
        }
        return result;
    }
}
