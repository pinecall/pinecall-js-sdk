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
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, extname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Agent } from "../agent.js";
import type { Call } from "../call.js";
import type { Pinecall } from "../client.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface EventServerOptions {
    /** Port to listen on for WebSocket. Default: 4100 */
    port?: number;
    /** Host to bind to. Default: "127.0.0.1" (localhost only) */
    host?: string;
    /**
     * Require token auth for WS connections. Default: false.
     * When true, clients must pass `Authorization: Bearer <token>` header.
     */
    requireAuth?: boolean;
    /** Allowed origins for WebSocket connections. */
    allowedOrigins?: string[];
    /** Pinecall client instance (needed for REST API deploy/manage). */
    pinecall?: Pinecall;
    /** Serve the built-in dashboard UI. Default: true. */
    ui?: boolean;
}

// ── Events we forward ─────────────────────────────────────────────────────

const AGENT_EVENTS = [
    "call.started", "call.ended",
    "channel.added", "channel.configured", "channel.removed",
] as const;

const CALL_EVENTS = [
    "speech.started", "speech.ended",
    "user.speaking", "user.message",
    "eager.turn", "turn.end", "turn.pause",
    "turn.continued", "turn.resumed",
    "bot.speaking", "bot.word", "bot.finished", "bot.interrupted",
    "message.confirmed", "reply.rejected",
    "audio.metrics",
    "call.held", "call.unheld",
    "call.muted", "call.unmuted",
] as const;

const LLM_EVENTS = [
    "llm.start", "llm.token", "llm.done",
    "llm.tool_call", "llm.tool_result",
    "llm.error",
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
    private _http: ReturnType<typeof createServer> | null = null;
    private _port: number;
    private _host: string;
    private _agents: Set<Agent> = new Set();
    private _allowedOrigins: string[] | null;
    private _requireAuth: boolean;
    private _tokens: TokenStore = new Map();
    private _agentTokens: Map<string, string> = new Map();
    private _pc: Pinecall | null;
    private _ui: boolean;
    private _dashboardDir: string;

    // MIME type map for static serving
    private static _mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
    };

    constructor(opts: EventServerOptions = {}) {
        this._port = opts.port ?? 4100;
        this._host = opts.host ?? "127.0.0.1";
        this._allowedOrigins = opts.allowedOrigins ?? null;
        this._requireAuth = opts.requireAuth ?? false;
        this._pc = opts.pinecall ?? null;
        this._ui = opts.ui ?? true;

        // Resolve dashboard dir relative to compiled server code
        // In dist/server/index.js → ../dashboard/
        const thisDir = typeof __dirname !== 'undefined'
            ? __dirname
            : join(fileURLToPath(import.meta.url), '..');
        this._dashboardDir = join(thisDir, '..', 'dashboard');
    }

    /** Number of connected WebSocket clients. */
    get clients(): number {
        return this._wss?.clients.size ?? 0;
    }

    /** Whether the server is running. */
    get listening(): boolean {
        return this._wss !== null;
    }

    /** Start the server (HTTP + WebSocket on the same port). */
    start(): void {
        if (this._wss) return;

        // Single HTTP server for REST + WS upgrade
        this._http = createServer((req, res) => {
            // CORS
            const origin = req.headers.origin ?? "*";
            if (this._allowedOrigins && !this._allowedOrigins.includes(origin)) {
                res.writeHead(403); res.end("Forbidden"); return;
            }
            res.setHeader("Access-Control-Allow-Origin", this._allowedOrigins ? origin : "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

            if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

            // Auth check for REST
            if (this._requireAuth) {
                const auth = req.headers["authorization"];
                if (!auth?.startsWith("Bearer ") || !this._tokens.has(auth.slice(7))) {
                    this._json(res, 401, { error: "Unauthorized" }); return;
                }
            }

            // Parse body for POST/PATCH
            if (req.method === "POST" || req.method === "PATCH") {
                let body = "";
                req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
                req.on("end", () => {
                    try {
                        const data = body ? JSON.parse(body) : {};
                        this._handleApi(req, res, data);
                    } catch {
                        this._json(res, 400, { error: "Invalid JSON" });
                    }
                });
            } else {
                this._handleApi(req, res, {});
            }
        });

        // WebSocket server — noServer mode, shares the HTTP server
        this._wss = new WebSocketServer({
            noServer: true,
            verifyClient: (info: { origin: string; req: IncomingMessage }, cb: (ok: boolean, code?: number, msg?: string) => void) => {
                if (this._allowedOrigins && !this._allowedOrigins.includes(info.origin)) {
                    cb(false, 403, "Origin not allowed"); return;
                }
                if (this._requireAuth) {
                    const auth = info.req.headers["authorization"];
                    if (!auth || !auth.startsWith("Bearer ")) { cb(false, 401, "Missing Authorization header"); return; }
                    if (!this._tokens.has(auth.slice(7))) { cb(false, 401, "Invalid token"); return; }
                }
                cb(true);
            },
        });

        // Handle WS upgrade
        this._http.on("upgrade", (req, socket, head) => {
            this._wss!.handleUpgrade(req, socket, head, (ws) => {
                this._wss!.emit("connection", ws, req);
            });
        });

        this._wss.on("connection", (ws: AuthedSocket, req: IncomingMessage) => {
            const auth = req.headers["authorization"];
            if (auth?.startsWith("Bearer ")) {
                ws._agentScope = this._tokens.get(auth.slice(7)) ?? null;
            } else {
                ws._agentScope = null;
            }

            const visibleAgents = ws._agentScope
                ? [...this._agents].filter(a => ws._agentScope!.has(a.id)).map(a => a.id)
                : [...this._agents].map(a => a.id);

            ws.send(JSON.stringify({
                event: "server.connected",
                agents: visibleAgents,
                port: this._port,
                languages: this._getLanguagePresets(),
            }));

            ws.on("message", (raw: Buffer | string) => {
                try {
                    const msg = JSON.parse(raw.toString());
                    this._handleCommand(msg, ws);
                } catch {
                    ws.send(JSON.stringify({ event: "error", message: "Invalid JSON" }));
                }
            });
        });

        this._http.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "EADDRINUSE") {
                console.error(`⚠ Port ${this._port} already in use`);
            } else {
                console.error(`⚠ Server error: ${err.message}`);
            }
        });

        this._http.listen(this._port, this._host);

        // Forward SDK connection lifecycle to dashboard WS clients
        if (this._pc) {
            this._pc.on("disconnected", (reason: string) => {
                this._broadcastAll({ event: "server.disconnected", reason });
            });
            this._pc.on("reconnecting", (attempt: number) => {
                this._broadcastAll({ event: "server.reconnecting", attempt });
            });
            this._pc.on("connected", () => {
                const agents = [...this._agents].map(a => a.id);
                this._broadcastAll({ event: "server.connected", agents, port: this._port });
            });
        }
    }

    /** Stop the server. */
    stop(): void {
        if (this._wss) { this._wss.close(); this._wss = null; }
        if (this._http) { this._http.close(); this._http = null; }
    }

    /** Server port (REST + WS). */
    get port(): number {
        return this._port;
    }

    private async _handleApi(req: IncomingMessage, res: ServerResponse, body: any): Promise<void> {
        const url = req.url ?? "/";
        const method = req.method ?? "GET";

        // Serve WebRTC IIFE bundle at /pinecall-webrtc.js
        if (method === "GET" && url === "/pinecall-webrtc.js") {
            const bundlePath = join(__dirname, "..", "pinecall-webrtc.iife.global.js");
            if (existsSync(bundlePath)) {
                const content = readFileSync(bundlePath);
                res.writeHead(200, {
                    "Content-Type": "application/javascript",
                    "Cache-Control": "public, max-age=3600",
                    "Access-Control-Allow-Origin": "*",
                });
                res.end(content);
            } else {
                this._json(res, 404, { error: "WebRTC bundle not found. Run 'npx tsup' to build." });
            }
            return;
        }

        // GET /server-info — Pinecall server URL + app IDs (for WebRTC)
        if (method === "GET" && url === "/server-info") {
            const wsUrl = (this._pc as any)?._opts?.url ?? "wss://voice.pinecall.io/client";
            // Convert ws URL to http base for WebRTC endpoints
            const httpUrl = wsUrl
                .replace(/\/client\/?$/, "")  // strip /client path
                .replace(/^wss:\/\//, "https://")
                .replace(/^ws:\/\//, "http://");
            const appIds = [...this._agents].map(a => a.id);
            this._json(res, 200, { pinecallServer: httpUrl, appIds });
            return;
        }

        // GET /webrtc/token?agent_id=xxx — Get a WebRTC token for browser connections
        // Proxies to app.pinecall.io using the SDK's API key — browser never sees the key.
        if (method === "GET" && url.startsWith("/webrtc/token")) {
            const urlObj = new URL(url, `http://${req.headers.host ?? "localhost"}`);
            const agentId = urlObj.searchParams.get("agent_id");

            if (!agentId) {
                this._json(res, 400, { error: "Missing agent_id query parameter" });
                return;
            }

            // Verify agent is attached to this event server
            const agent = this._findAgent(agentId);
            if (!agent) {
                this._json(res, 404, { error: `Agent '${agentId}' not found` });
                return;
            }

            // Get API key from the Pinecall client
            const apiKey = (this._pc as any)?._opts?.apiKey;
            if (!apiKey) {
                this._json(res, 500, { error: "No API key configured" });
                return;
            }

            try {
                const { fetchWebRTCToken } = await import("../api.js");
                const tokenData = await fetchWebRTCToken({ apiKey, agentId });

                // Add server URL for convenience
                const wsUrl = (this._pc as any)?._opts?.url ?? "wss://voice.pinecall.io/client";
                const httpUrl = wsUrl
                    .replace(/\/client\/?$/, "")
                    .replace(/^wss:\/\//, "https://")
                    .replace(/^ws:\/\//, "http://");

                this._json(res, 200, {
                    ...tokenData,
                    server: tokenData.server ?? httpUrl,
                });
            } catch (err) {
                this._json(res, 500, { error: `Token fetch failed: ${err}` });
            }
            return;
        }

        // GET /agents — list agents
        if (method === "GET" && url === "/agents") {
            const agents = [...this._agents].map(a => ({
                id: a.id,
                channels: [...((a as any)._channels || new Map())].map(([ref]: [string]) => ref),
                calls: [...a.calls.keys()],
                token: this._agentTokens.get(a.id),
                config: a.getConfig?.() ?? {},
            }));
            this._json(res, 200, { agents });
            return;
        }

        // GET /calls — list all calls
        if (method === "GET" && url === "/calls") {
            const calls: any[] = [];
            for (const agent of this._agents) {
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
            this._json(res, 200, { calls });
            return;
        }

        // POST /agents — deploy a new agent
        if (method === "POST" && url === "/agents") {
            if (!this._pc) {
                this._json(res, 500, { error: "No Pinecall client configured" });
                return;
            }
            const { name, ...config } = body;
            if (!name) {
                this._json(res, 400, { error: "Missing 'name' field" });
                return;
            }
            const agent = this._pc.agent(name, config);
            if (config.phone) agent.addChannel("phone", config.phone, config);
            const token = this.attach(agent);
            this._json(res, 201, { ok: true, name, token });
            return;
        }

        // PATCH /agents/:name — configure agent
        const patchMatch = url.match(/^\/agents\/([^/]+)$/);
        if (method === "PATCH" && patchMatch) {
            const name = decodeURIComponent(patchMatch[1]);
            const agent = this._findAgent(name);
            if (!agent) {
                this._json(res, 404, { error: `Agent not found: ${name}` });
                return;
            }
            agent.configure(body);
            this._json(res, 200, { ok: true, agent_id: agent.id });
            return;
        }

        // DELETE /agents/:name — detach agent
        const deleteMatch = url.match(/^\/agents\/([^/]+)$/);
        if (method === "DELETE" && deleteMatch) {
            const name = decodeURIComponent(deleteMatch[1]);
            const agent = this._findAgent(name);
            if (!agent) {
                this._json(res, 404, { error: `Agent not found: ${name}` });
                return;
            }
            this.detach(agent);
            this._json(res, 200, { ok: true, agent_id: agent.id });
            return;
        }

        // POST /agents/:name/dial — dial from agent
        const dialMatch = url.match(/^\/agents\/([^/]+)\/dial$/);
        if (method === "POST" && dialMatch) {
            const name = decodeURIComponent(dialMatch[1]);
            const agent = this._findAgent(name);
            if (!agent) {
                this._json(res, 404, { error: `Agent not found: ${name}` });
                return;
            }
            if (!body.to || !body.from) {
                this._json(res, 400, { error: "Missing 'to' or 'from'" });
                return;
            }
            agent.dial({ to: body.to, from: body.from, greeting: body.greeting, metadata: body.metadata });
            this._json(res, 200, { ok: true, agent_id: agent.id, to: body.to });
            return;
        }

        // POST /calls/:id/hangup
        const hangupMatch = url.match(/^\/calls\/([^/]+)\/hangup$/);
        if (method === "POST" && hangupMatch) {
            const found = this._findCall(decodeURIComponent(hangupMatch[1]));
            if (!found) {
                this._json(res, 404, { error: "Call not found" });
                return;
            }
            found.call.hangup();
            this._json(res, 200, { ok: true, call_id: found.call.id });
            return;
        }

        // PATCH /calls/:id — configure call
        const callPatchMatch = url.match(/^\/calls\/([^/]+)$/);
        if (method === "PATCH" && callPatchMatch) {
            const found = this._findCall(decodeURIComponent(callPatchMatch[1]));
            if (!found) {
                this._json(res, 404, { error: "Call not found" });
                return;
            }
            found.call.configure(body);
            this._json(res, 200, { ok: true, call_id: found.call.id });
            return;
        }

        // GET /phones
        if (method === "GET" && url === "/phones") {
            if (!this._pc) {
                this._json(res, 500, { error: "No Pinecall client configured" });
                return;
            }
            this._pc.fetchPhones().then((phones: any[]) => {
                this._json(res, 200, { phones });
            }).catch((err: Error) => {
                this._json(res, 500, { error: err.message });
            });
            return;
        }

        // GET /voices?provider=elevenlabs
        if (method === "GET" && (url === "/voices" || url.startsWith("/voices?"))) {
            const urlObj = new URL(url, `http://${this._host}`);
            const provider = urlObj.searchParams.get("provider") ?? "elevenlabs";
            import("../api.js").then(({ fetchVoices }) => {
                fetchVoices({ provider }).then((voices: any[]) => {
                    this._json(res, 200, { voices });
                }).catch((err: Error) => {
                    this._json(res, 500, { error: err.message });
                });
            });
            return;
        }

        // No API route matched — try serving static dashboard files
        if (this._ui) {
            this._serveStatic(req, res);
            return;
        }
        this._json(res, 404, { error: "Not found" });
    }

    private _json(res: ServerResponse, status: number, data: any): void {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
    }

    /** Serve static files from the embedded dashboard build. */
    private _serveStatic(req: IncomingMessage, res: ServerResponse): void {
        const url = (req.url ?? "/").split("?")[0];
        const safePath = url.replace(/\.\./g, "").replace(/\/+/g, "/");
        let filePath = join(this._dashboardDir, safePath === "/" ? "index.html" : safePath);

        // If file doesn't exist, try index.html (SPA routing)
        if (!existsSync(filePath)) {
            filePath = join(this._dashboardDir, "index.html");
            if (!existsSync(filePath)) {
                this._json(res, 404, { error: "Dashboard not found. Run `npm run build:dashboard` first." });
                return;
            }
        }

        try {
            const content = readFileSync(filePath);
            const ext = extname(filePath).toLowerCase();
            const mime = EventServer._mimeTypes[ext] || "application/octet-stream";
            res.writeHead(200, { "Content-Type": mime, "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable" });
            res.end(content);
        } catch {
            this._json(res, 500, { error: "Failed to read file" });
        }
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

    /** Broadcast to ALL connected clients (unscoped — for server lifecycle events). */
    private _broadcastAll(data: Record<string, unknown>): void {
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
            // args: [type, ref, channelInstance?]
            const channelObj = args[2];
            const config: Record<string, unknown> = {};
            if (channelObj) {
                if (channelObj.voice) config.voice = channelObj.voice;
                if (channelObj.language) config.language = channelObj.language;
                if (channelObj.stt) config.stt = channelObj.stt;
                if (channelObj.turnDetection) config.turnDetection = channelObj.turnDetection;
                if (channelObj.greeting && typeof channelObj.greeting === "string") config.greeting = channelObj.greeting;
            }
            return { type: args[0], ref: args[1], ...(Object.keys(config).length > 0 ? { config } : {}) };
        }
        return {};
    }

    /** Build language presets from agent channels for dashboard language switcher. */
    private _getLanguagePresets(): Record<string, Record<string, unknown>>[] {
        const presets: Record<string, Record<string, unknown>>[] = [];
        for (const agent of this._agents) {
            const agentAny = agent as any;
            const agentPresets: Record<string, Record<string, unknown>> = {};

            // Default preset from agent base config
            agentPresets["default"] = {
                label: "Default",
                language: agentAny.language || "en",
                ...(agentAny.voice ? { voice: agentAny.voice } : {}),
            };

            // Extract from channels array (Phone channels with language override become presets)
            const channels = agentAny.channels || [];
            const phone = agentAny.phone;
            const allCh = phone ? [phone, ...channels] : channels;

            for (const ch of allCh) {
                if (ch?.type === "phone" && ch.language) {
                    const lang = ch.language;
                    if (!agentPresets[lang]) {
                        const preset: Record<string, unknown> = { label: lang.toUpperCase(), language: lang };
                        if (ch.voice) preset.voice = ch.voice;
                        if (ch.stt) preset.stt = ch.stt;
                        if (ch.turnDetection) preset.turnDetection = ch.turnDetection;
                        if (ch.greeting && typeof ch.greeting === "string") preset.greeting = ch.greeting;
                        agentPresets[lang] = preset;
                    }
                }
            }

            if (Object.keys(agentPresets).length > 1) {
                presets.push(agentPresets);
            }
        }
        return presets;
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
                        config: a.getConfig?.() ?? {},
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

            case "forward": {
                const found = this._findCall(msg.call_id);
                if (!found) { reply({ event: "error", action: "forward", message: `Call not found: ${msg.call_id}` }); return; }
                if (!this._hasScope(ws, found.agent.id)) { reply({ event: "error", action: "forward", message: "Permission denied" }); return; }
                if (!msg.to) { reply({ event: "error", action: "forward", message: "Missing 'to' number" }); return; }
                found.call.forward(msg.to);
                reply({ event: "action.ok", action: "forward", call_id: found.call.id, to: msg.to });
                break;
            }

            case "dtmf": {
                const found = this._findCall(msg.call_id);
                if (!found) { reply({ event: "error", action: "dtmf", message: `Call not found: ${msg.call_id}` }); return; }
                if (!this._hasScope(ws, found.agent.id)) { reply({ event: "error", action: "dtmf", message: "Permission denied" }); return; }
                if (!msg.digits) { reply({ event: "error", action: "dtmf", message: "Missing 'digits'" }); return; }
                found.call.sendDTMF(msg.digits);
                reply({ event: "action.ok", action: "dtmf", call_id: found.call.id, digits: msg.digits });
                break;
            }

            case "hold": {
                const found = this._findCall(msg.call_id);
                if (!found) { reply({ event: "error", action: "hold", message: `Call not found: ${msg.call_id}` }); return; }
                if (!this._hasScope(ws, found.agent.id)) { reply({ event: "error", action: "hold", message: "Permission denied" }); return; }
                found.call.hold();
                reply({ event: "action.ok", action: "hold", call_id: found.call.id });
                break;
            }

            case "unhold": {
                const found = this._findCall(msg.call_id);
                if (!found) { reply({ event: "error", action: "unhold", message: `Call not found: ${msg.call_id}` }); return; }
                if (!this._hasScope(ws, found.agent.id)) { reply({ event: "error", action: "unhold", message: "Permission denied" }); return; }
                found.call.unhold();
                reply({ event: "action.ok", action: "unhold", call_id: found.call.id });
                break;
            }

            case "mute": {
                const found = this._findCall(msg.call_id);
                if (!found) { reply({ event: "error", action: "mute", message: `Call not found: ${msg.call_id}` }); return; }
                if (!this._hasScope(ws, found.agent.id)) { reply({ event: "error", action: "mute", message: "Permission denied" }); return; }
                found.call.mute();
                reply({ event: "action.ok", action: "mute", call_id: found.call.id });
                break;
            }

            case "unmute": {
                const found = this._findCall(msg.call_id);
                if (!found) { reply({ event: "error", action: "unmute", message: `Call not found: ${msg.call_id}` }); return; }
                if (!this._hasScope(ws, found.agent.id)) { reply({ event: "error", action: "unmute", message: "Permission denied" }); return; }
                found.call.unmute();
                reply({ event: "action.ok", action: "unmute", call_id: found.call.id });
                break;
            }

            case "say": {
                const found = this._findCall(msg.call_id);
                if (!found) { reply({ event: "error", action: "say", message: `Call not found: ${msg.call_id}` }); return; }
                if (!this._hasScope(ws, found.agent.id)) { reply({ event: "error", action: "say", message: "Permission denied" }); return; }
                if (!msg.text) { reply({ event: "error", action: "say", message: "Missing 'text'" }); return; }
                found.call.say(msg.text, msg.message_id);
                reply({ event: "action.ok", action: "say", call_id: found.call.id });
                break;
            }

            case "reply": {
                const found = this._findCall(msg.call_id);
                if (!found) { reply({ event: "error", action: "reply", message: `Call not found: ${msg.call_id}` }); return; }
                if (!this._hasScope(ws, found.agent.id)) { reply({ event: "error", action: "reply", message: "Permission denied" }); return; }
                if (!msg.text) { reply({ event: "error", action: "reply", message: "Missing 'text'" }); return; }
                found.call.reply(msg.text, { messageId: msg.message_id, inReplyTo: msg.in_reply_to });
                reply({ event: "action.ok", action: "reply", call_id: found.call.id });
                break;
            }

            default:
                reply({ event: "error", message: `Unknown action: ${msg.action}` });
        }
    }
}
