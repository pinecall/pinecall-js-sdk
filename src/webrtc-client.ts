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
 * const webrtc = new PinecallWebRTC("https://your-server.pinecall.ai", "my-agent");
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

// ─── PinecallWebRTC ──────────────────────────────────────────────────────

export class PinecallWebRTC {
    private _serverUrl: string;
    private _appId: string;
    private _options: WebRTCOptions;

    private _pc: RTCPeerConnection | null = null;
    private _localStream: MediaStream | null = null;
    private _remoteAudio: HTMLAudioElement | null = null;
    private _dataChannel: RTCDataChannel | null = null;
    private _pcId: string | null = null;
    private _sessionId: string | null = null;
    private _connected = false;
    private _listeners: Map<string, Set<Function>> = new Map();
    private _pingInterval: ReturnType<typeof setInterval> | null = null;

    constructor(serverUrl: string, appId: string, options?: WebRTCOptions) {
        // Normalize URL — strip trailing slash, convert ws:// to http://
        this._serverUrl = serverUrl
            .replace(/\/$/, "")
            .replace(/^wss:\/\//, "https://")
            .replace(/^ws:\/\//, "http://");
        this._appId = appId;
        this._options = options ?? {};
    }

    // ── Public API ───────────────────────────────────────────────────────

    /** Connect to the Pinecall server via WebRTC. */
    async connect(): Promise<void> {
        if (this._pc) throw new Error("Already connected. Call disconnect() first.");

        try {
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
                if (!this._remoteAudio) {
                    this._remoteAudio = new Audio();
                    this._remoteAudio.autoplay = true;
                }
                this._remoteAudio.srcObject = e.streams[0];
            };

            // 6. Handle data channel (created by server)
            this._pc.ondatachannel = (e) => {
                this._dataChannel = e.channel;
                this._dataChannel.onmessage = (msg) => {
                    try {
                        const data = JSON.parse(msg.data);
                        const event = data.event;
                        if (event) {
                            this._emit(event, data);
                        }
                    } catch { /* ignore non-JSON */ }
                };
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

            // 10. Send offer to server
            const res = await fetch(
                `${this._serverUrl}/webrtc/offer?app_id=${encodeURIComponent(this._appId)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sdp: this._pc.localDescription!.sdp,
                        type: this._pc.localDescription!.type,
                    }),
                },
            );

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

    // ── State ────────────────────────────────────────────────────────────

    get isConnected(): boolean { return this._connected; }
    get sessionId(): string | null { return this._sessionId; }
    get pcId(): string | null { return this._pcId; }

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
