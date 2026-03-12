/**
 * Channel — declarative config container for audio channels.
 *
 * Subclass to define reusable channel configurations.
 *
 * @example
 * ```javascript
 * class USPhone extends Phone {
 *   number = "+13186330963";
 *   stt = {
 *     provider: "deepgram-flux",
 *     language: "en",
 *     keyterms: ["Pinecall", "GPTAgent"],
 *   };
 *   turnDetection = "native";
 *   interruption = {
 *     enabled: true,
 *     energy_threshold_db: -35.0,
 *     min_duration_ms: 300,
 *   };
 * }
 * ```
 */

import type { ChannelConfig, VoiceShortcut } from "../agent.js";
import type { SessionConfig } from "../types/config.js";

// ─── Channel base ────────────────────────────────────────────────────────

export class Channel {
    /** Channel type. */
    readonly type: "phone" | "webrtc" | "mic" = "phone";

    // ── Shortcut fields ─────────────────────────────────────────────────

    /** Voice shortcut — e.g. "elevenlabs:voiceId" */
    voice?: VoiceShortcut;
    /** Language code — sets stt + tts language. */
    language?: string;
    /** STT config — string ("deepgram") or full object. */
    stt?: ChannelConfig["stt"];
    /** Turn detection — string ("smart_turn") or full object. */
    turnDetection?: ChannelConfig["turnDetection"];
    /**
     * Interruption config — false to disable, or full object:
     *   { enabled: true, energy_threshold_db: -35.0, min_duration_ms: 300 }
     */
    interruption?: ChannelConfig["interruption"];

    // ── Raw session config (for advanced TTS, VAD, etc.) ────────────────

    /**
     * Full session config for anything not covered by shortcuts.
     * Allows setting TTS speed/stability, VAD thresholds, speaker filter, etc.
     *
     * @example
     * config = {
     *   tts: { provider: "elevenlabs", voice_id: "abc", speed: 1.1, stability: 0.6 },
     *   vad: { threshold: 0.4, min_speech_ms: 200 },
     * }
     */
    config?: Partial<SessionConfig>;

    // ── Build the wire payload ──────────────────────────────────────────

    /** Build the config payload for this channel. */
    toConfig(): ChannelConfig {
        const cfg: ChannelConfig = {};
        if (this.voice) cfg.voice = this.voice;
        if (this.language) cfg.language = this.language;
        if (this.stt) cfg.stt = this.stt;
        if (this.turnDetection) cfg.turnDetection = this.turnDetection;
        if (this.interruption !== undefined) cfg.interruption = this.interruption;
        if (this.config) cfg.config = this.config;
        return cfg;
    }
}

// ─── Phone ───────────────────────────────────────────────────────────────

export class Phone extends Channel {
    override readonly type = "phone" as const;

    /** Phone number in E.164 format. */
    number = "";

    constructor(number?: string, overrides?: Partial<ChannelConfig>) {
        super();
        if (number) this.number = number;
        if (overrides) {
            if (overrides.voice) this.voice = overrides.voice;
            if (overrides.language) this.language = overrides.language;
            if (overrides.stt) this.stt = overrides.stt;
            if (overrides.turnDetection) this.turnDetection = overrides.turnDetection;
            if (overrides.interruption !== undefined) this.interruption = overrides.interruption;
            if (overrides.config) this.config = overrides.config;
        }
    }
}

// ─── WebRTC ──────────────────────────────────────────────────────────────

export class WebRTC extends Channel {
    override readonly type = "webrtc" as const;
}
