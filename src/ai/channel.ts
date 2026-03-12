/**
 * Channel — declarative config container for audio channels.
 *
 * Subclass to define reusable channel configurations,
 * or use constructors for inline config.
 *
 * @example
 * ```javascript
 * // Subclass for reusable configs
 * class SpanishPhone extends Phone {
 *   number = "+13186330963";
 *   voice = {
 *     provider: "elevenlabs",
 *     voice_id: "VmejBeYhbrcTPwDniox7",
 *     speed: 1.05,
 *     stability: 0.55,
 *   };
 *   stt = { provider: "deepgram", model: "nova-3", language: "es" };
 *   turnDetection = "smart_turn";
 *   interruption = { enabled: true, min_duration_ms: 300 };
 * }
 *
 * // Or inline via constructor
 * const phone = new Phone("+13186330963", spanishDefaults);
 * const webrtc = new WebRTC(spanishDefaults);
 * ```
 */

import type { ChannelConfig, VoiceShortcut } from "../agent.js";
import type { SessionConfig } from "../types/config.js";

// ─── Channel base ────────────────────────────────────────────────────────

export class Channel {
    /** Channel type. */
    readonly type: "phone" | "webrtc" | "mic" = "phone";

    // ── Config fields ───────────────────────────────────────────────────

    /**
     * Voice / TTS config.
     *
     * String shortcut: "elevenlabs:voiceId"
     * Full object: { provider, voice_id, speed, stability, similarity_boost, ... }
     *
     * @example
     * voice = "elevenlabs:EXAVITQu4vr4xnSDxMaL";
     * voice = {
     *   provider: "elevenlabs",
     *   voice_id: "EXAVITQu4vr4xnSDxMaL",
     *   model: "eleven_flash_v2_5",
     *   speed: 1.05,
     *   stability: 0.55,
     *   similarity_boost: 0.8,
     * };
     */
    voice?: VoiceShortcut;

    /** Language code — sets stt + tts language. */
    language?: string;

    /**
     * STT config — string shortcut or full object.
     *
     * @example
     * stt = "deepgram";
     * stt = {
     *   provider: "deepgram",
     *   model: "nova-3",
     *   language: "es",
     *   keywords: ["Pinecall"],
     *   keyterms: ["GPT Agent"],
     * };
     * stt = {
     *   provider: "deepgram-flux",
     *   eot_threshold: 0.7,
     *   eager_eot_threshold: 0.5,
     * };
     */
    stt?: ChannelConfig["stt"];

    /** Turn detection — "smart_turn", "native", "silence", or full object. */
    turnDetection?: ChannelConfig["turnDetection"];

    /**
     * Interruption / barge-in config.
     *
     * @example
     * interruption = false;               // disable completely
     * interruption = {
     *   enabled: true,
     *   energy_threshold_db: -35.0,       // min audio energy (dB)
     *   min_duration_ms: 300,             // min speech before interrupting
     * };
     */
    interruption?: ChannelConfig["interruption"];

    /**
     * Per-channel greeting — said on call.started.
     * Overrides the agent-level greeting for calls on this channel.
     *
     * @example
     * greeting = "¡Hola! ¿En qué puedo ayudarte?";
     */
    greeting?: string;

    /**
     * Raw session config — for anything not covered by shortcuts.
     * Use for VAD tuning, speaker filter, analysis, etc.
     *
     * @example
     * config = {
     *   vad: { threshold: 0.4, min_speech_ms: 200 },
     *   speaker_filter: { enabled: true },
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

    // ── Apply overrides from object ────────────────────────────────────

    /** @internal Apply config overrides from a plain object. */
    protected _applyOverrides(overrides: Partial<ChannelConfig>): void {
        if (overrides.voice) this.voice = overrides.voice;
        if (overrides.language) this.language = overrides.language;
        if (overrides.stt) this.stt = overrides.stt;
        if (overrides.turnDetection) this.turnDetection = overrides.turnDetection;
        if (overrides.interruption !== undefined) this.interruption = overrides.interruption;
        if (overrides.config) this.config = overrides.config;
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
        if (overrides) this._applyOverrides(overrides);
    }
}

// ─── WebRTC ──────────────────────────────────────────────────────────────

export class WebRTC extends Channel {
    override readonly type = "webrtc" as const;

    constructor(overrides?: Partial<ChannelConfig>) {
        super();
        if (overrides) this._applyOverrides(overrides);
    }
}
