/**
 * PinecallWebRTC — Browser-side WebRTC client for Pinecall voice agents.
 *
 * Connects to a Pinecall server via WebRTC, sending microphone audio
 * and receiving bot audio. Events are received via the data channel.
 *
 * @example
 * ```typescript
 * import { PinecallWebRTC } from "@pinecall/sdk/webrtc";
 *
 * const webrtc = new PinecallWebRTC("my-agent");
 * webrtc.on("bot.word", (data) => console.log(data.word));
 * await webrtc.connect();
 * // ... later
 * webrtc.disconnect();
 * ```
 *
 * @module @pinecall/sdk/webrtc
 * @browser Browser-only — requires navigator.mediaDevices and RTCPeerConnection.
 */

// ─── Types ───────────────────────────────────────────────────────────────

export interface WebRTCOptions {
    /** Pre-fetched WebRTC token. If provided, skips auto-discovery. */
    token?: string;
    /** Pinecall voice server URL override. */
    server?: string;
    /** Audio constraints for getUserMedia. */
    audio?: MediaStreamConstraints["audio"];
    /** ICE servers override. If not provided, fetched from server. */
    iceServers?: RTCIceServer[];
    /** Auto-reconnect on disconnect. Default: false. */
    autoReconnect?: boolean;
}

export interface WebRTCEventMap {
    "connected": () => void;
    "disconnected": (reason: string) => void;
    "error": (error: Error) => void;
    "session.started": (data: { session_id: string; call_id: string }) => void;
    "session.ended": (data: { session_id: string; reason: string }) => void;
    "bot.speaking": (data: { message_id: string; text: string }) => void;
    "bot.word": (data: { message_id: string; word: string; word_index: number }) => void;
    "bot.finished": (data: { message_id: string; duration_ms: number }) => void;
    "bot.interrupted": (data: { message_id: string }) => void;
    "user.speaking": (data: { text: string; turn_id: number }) => void;
    "user.message": (data: { text: string; message_id: string }) => void;
    "turn.pause": (data: { turn_id: number; probability: number }) => void;
    "turn.end": (data: { turn_id: number; probability: number }) => void;
    "audio.metrics": (data: { source: string; energy_db: number; rms: number; peak: number; is_speech: boolean; vad_prob: number }) => void;
    "config.updated": (data: { config: Record<string, unknown> }) => void;
}

const DEFAULT_SERVER = "https://voice.pinecall.io";
const DEFAULT_EVENT_SERVER = "http://localhost:4100";

// ─── PinecallWebRTC ──────────────────────────────────────────────────────

export class PinecallWebRTC {
    private _serverUrl: string;
    private _appId: string;
    private _options: WebRTCOptions;
    private _token: string | null = null;

    private _pc: RTCPeerConnection | null = null;
    private _localStream: MediaStream | null = null;
    private _remoteStream: MediaStream | null = null;
    private _remoteAudio: HTMLAudioElement | null = null;
    private _dataChannel: RTCDataChannel | null = null;
    private _pcId: string | null = null;
    private _sessionId: string | null = null;
    private _connected = false;
    private _muted = false;
    private _listeners: Map<string, Set<Function>> = new Map();
    private _pingInterval: ReturnType<typeof setInterval> | null = null;

    /**
     * Create a PinecallWebRTC instance.
     *
     * ```typescript
     * const webrtc = new PinecallWebRTC("my-agent");
     * webrtc.on("bot.speaking", (d) => console.log(d.text));
     * await webrtc.connect();
     * ```
     *
     * On `connect()`, the SDK automatically gets a WebRTC token from
     * the SDK event server (which proxies to app.pinecall.io using
     * your API key — no secrets ever touch the browser).
     *
     * @param appId - Agent ID (must match the ID registered in your SDK server).
     * @param options - Optional overrides (pre-fetched token, server URL, audio constraints).
     */
    constructor(appId: string, options?: WebRTCOptions) {
        const server = options?.server;
        this._serverUrl = server
            ? server.replace(/\/$/, "").replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://")
            : DEFAULT_SERVER;
        this._appId = appId;
        this._options = options ?? {};
        this._token = options?.token ?? null;
    }

    // ── Public API ───────────────────────────────────────────────────────

    /** Connect to the Pinecall server via WebRTC. */
    async connect(): Promise<void> {
        if (this._pc) throw new Error("Already connected. Call disconnect() first.");

        try {
            // 0. Get token from event server (which proxies to app.pinecall.io)
            if (!this._token) {
                await this._fetchTokenFromEventServer();
            }
            // 1. Get ICE servers
            const iceServers = this._options.iceServers ?? await this._fetchIceServers();

            // 2. Get microphone
            this._localStream = await navigator.mediaDevices.getUserMedia({
                audio: this._options.audio ?? {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                video: false,
            });

            // 3. Create peer connection
            this._pc = new RTCPeerConnection({ iceServers });

            // 4. Add mic tracks
            for (const track of this._localStream.getTracks()) {
                this._pc.addTrack(track, this._localStream);
            }

            // 5. Handle remote audio (TTS from server)
            this._pc.ontrack = (e) => {
                this._remoteStream = e.streams[0];
                if (!this._remoteAudio) {
                    this._remoteAudio = new Audio();
                    this._remoteAudio.autoplay = true;
                }
                this._remoteAudio.srcObject = e.streams[0];
            };

            // 6. Create data channel (browser creates it, server receives via ondatachannel)
            this._dataChannel = this._pc.createDataChannel("events", { ordered: true });
            this._dataChannel.onmessage = (msg) => {
                try {
                    const data = JSON.parse(msg.data);
                    const event = data.event;
                    if (event) {
                        this._emit(event, data);
                    }
                } catch { /* ignore non-JSON */ }
            };

            // 7. Connection state
            this._pc.onconnectionstatechange = () => {
                const state = this._pc?.connectionState;
                if (state === "connected" && !this._connected) {
                    this._connected = true;
                    this._startPing();
                    this._emit("connected");
                } else if (state === "disconnected" || state === "failed") {
                    this._handleDisconnect(state);
                }
            };

            // 8. Create offer
            const offer = await this._pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false,
            });
            await this._pc.setLocalDescription(offer);

            // 9. Wait for ICE gathering (with timeout)
            await this._waitForIceGathering(2000);

            // 10. Send offer to server — always use token auth
            const offerBody: Record<string, unknown> = {
                sdp: this._pc.localDescription!.sdp,
                type: this._pc.localDescription!.type,
                token: this._token,
            };

            const offerUrl = `${this._serverUrl}/webrtc/offer`;

            const res = await fetch(offerUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(offerBody),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: res.statusText }));
                throw new Error(err.detail || `WebRTC offer failed: ${res.status}`);
            }

            const answer = await res.json();
            this._pcId = answer.pc_id;
            this._sessionId = answer.session_id;

            // 11. Set remote description (server's answer)
            await this._pc.setRemoteDescription({
                type: answer.type,
                sdp: answer.sdp,
            });

        } catch (err) {
            this.disconnect();
            this._emit("error", err instanceof Error ? err : new Error(String(err)));
            throw err;
        }
    }

    /** Disconnect from the server. */
    disconnect(): void {
        this._stopPing();

        if (this._pc) {
            this._pc.close();
            this._pc = null;
        }
        if (this._localStream) {
            for (const track of this._localStream.getTracks()) track.stop();
            this._localStream = null;
        }
        if (this._remoteAudio) {
            this._remoteAudio.pause();
            this._remoteAudio.srcObject = null;
            this._remoteAudio = null;
        }
        this._remoteStream = null;
        this._dataChannel = null;
        this._pcId = null;
        this._sessionId = null;

        if (this._connected) {
            this._connected = false;
            this._emit("disconnected", "manual");
        }
    }

    /** Send a message via the data channel. */
    send(data: Record<string, unknown>): void {
        if (this._dataChannel?.readyState === "open") {
            this._dataChannel.send(JSON.stringify(data));
        }
    }

    // ── Mute / Unmute ────────────────────────────────────────────────────

    /** Mute the microphone. Disables the audio track AND tells the server to pause STT. */
    mute(): void {
        if (this._muted) return;
        this._muted = true;
        this._localStream?.getAudioTracks().forEach(t => t.enabled = false);
        this.send({ action: "mute" });
        this._emit("muted");
    }

    /** Unmute the microphone. Enables the audio track AND tells the server to resume STT. */
    unmute(): void {
        if (!this._muted) return;
        this._muted = false;
        this._localStream?.getAudioTracks().forEach(t => t.enabled = true);
        this.send({ action: "unmute" });
        this._emit("unmuted");
    }

    /** Toggle mute state. Returns the new mute state. */
    toggleMute(): boolean {
        if (this._muted) this.unmute(); else this.mute();
        return this._muted;
    }

    // ── State ────────────────────────────────────────────────────────────

    get isConnected(): boolean { return this._connected; }
    get isMuted(): boolean { return this._muted; }
    get sessionId(): string | null { return this._sessionId; }
    get pcId(): string | null { return this._pcId; }
    /** The local MediaStream (mic). Useful for audio visualization. */
    get localStream(): MediaStream | null { return this._localStream; }
    /** The remote MediaStream (agent TTS). Useful for audio visualization. */
    get remoteStream(): MediaStream | null { return this._remoteStream; }

    // ── Events ───────────────────────────────────────────────────────────

    on(event: string, handler: (...args: any[]) => void): this {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event)!.add(handler);
        return this;
    }

    off(event: string, handler: (...args: any[]) => void): this {
        this._listeners.get(event)?.delete(handler);
        return this;
    }

    // ── Internal ─────────────────────────────────────────────────────────

    private _emit(event: string, ...args: any[]): void {
        const handlers = this._listeners.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try { (handler as Function)(...args); } catch { /* swallow */ }
            }
        }
    }

    /**
     * Fetch token from the SDK event server (which proxies to app.pinecall.io).
     * Tries same-origin first (when served by event server), then localhost:4100.
     * The API key lives in Node.js and never touches the browser.
     */
    private async _fetchTokenFromEventServer(): Promise<void> {
        const candidates: string[] = [];

        // If page is served from a port, try same origin first
        if (typeof location !== "undefined" && location.port) {
            candidates.push(location.origin);
        }
        candidates.push(DEFAULT_EVENT_SERVER);

        let lastError = "";

        for (const base of candidates) {
            try {
                // Discover voice server URL
                const infoRes = await fetch(`${base}/server-info`);
                if (infoRes.ok) {
                    const info = await infoRes.json();
                    if (!this._options.server && info.pinecallServer) {
                        this._serverUrl = info.pinecallServer;
                    }
                }

                // Get token
                const tokenRes = await fetch(
                    `${base}/webrtc/token?agent_id=${encodeURIComponent(this._appId)}`
                );
                if (!tokenRes.ok) {
                    const err = await tokenRes.json().catch(() => ({ error: tokenRes.statusText }));
                    lastError = (err as any).error || tokenRes.statusText;
                    continue;
                }

                const data = await tokenRes.json() as Record<string, unknown>;
                if (typeof data.token !== "string") {
                    lastError = "Token response missing 'token' field";
                    continue;
                }

                this._token = data.token;
                if (!this._options.server && typeof data.server === "string" && data.server) {
                    this._serverUrl = data.server;
                }
                return;
            } catch {
                lastError = `Event server not reachable at ${base}`;
            }
        }

        throw new Error(
            `Could not get WebRTC token: ${lastError}. ` +
            "Make sure your agent is running (pinecall run MyAgent.js)."
        );
    }

    private async _fetchIceServers(): Promise<RTCIceServer[]> {
        try {
            const res = await fetch(`${this._serverUrl}/webrtc/ice-servers`);
            if (res.ok) {
                const data = await res.json();
                return data.iceServers || data.ice_servers || [{ urls: "stun:stun.l.google.com:19302" }];
            }
        } catch { /* fallback */ }
        return [{ urls: "stun:stun.l.google.com:19302" }];
    }

    private _waitForIceGathering(timeoutMs: number): Promise<void> {
        return new Promise((resolve) => {
            if (!this._pc) return resolve();
            if (this._pc.iceGatheringState === "complete") return resolve();
            const timer = setTimeout(resolve, timeoutMs);
            this._pc.onicegatheringstatechange = () => {
                if (this._pc?.iceGatheringState === "complete") {
                    clearTimeout(timer);
                    resolve();
                }
            };
        });
    }

    private _startPing(): void {
        this._stopPing();
        this._pingInterval = setInterval(() => {
            if (this._dataChannel?.readyState === "open") {
                this._dataChannel.send("ping");
            }
        }, 1000);
    }

    private _stopPing(): void {
        if (this._pingInterval) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
    }

    private _handleDisconnect(reason: string): void {
        this._stopPing();
        if (this._connected) {
            this._connected = false;
            this._emit("disconnected", reason);
        }
    }
}
