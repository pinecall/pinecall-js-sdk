/**
 * Channel — declarative config container for audio channels.
 *
 * Subclass to define reusable channel configs,
 * or use constructors for inline config.
 *
 * @example
 * ```javascript
 * class SpanishPhone extends Phone {
 *   number = "+13186330963";
 *   voice = { provider: "elevenlabs", voice_id: "xyz", speed: 1.05 };
 *   stt = { provider: "deepgram", model: "nova-3", language: "es" };
 *   turnDetection = "smart_turn";
 * }
 *
 * const phone = new Phone("+13186330963");
 * const webrtc = new WebRTC();
 * ```
 */

import type { ChannelConfig, VoiceShortcut } from "../agent.js";
import type { SessionConfig } from "../types/config.js";

// ─── Channel base ────────────────────────────────────────────────────────

export class Channel {
    readonly type: "phone" | "webrtc" | "mic" = "phone";

    /** Voice — string shortcut "elevenlabs:id" or full TTS config object. */
    voice?: VoiceShortcut;
    /** Language code. */
    language?: string;
    /** STT config. */
    stt?: ChannelConfig["stt"];
    /** Turn detection — "smart_turn", "native", "silence", or full object. */
    turnDetection?: ChannelConfig["turnDetection"];
    /** Interruption — false to disable, or { energy_threshold_db, min_duration_ms }. */
    interruption?: ChannelConfig["interruption"];
    /** Per-channel greeting — overrides agent greeting. String or callback for dynamic greetings. */
    greeting?: string | ((call: import("../call.js").Call) => string | Promise<string>);
    /** Raw session config for anything not covered by shortcuts. */
    config?: Partial<SessionConfig>;

    /** Build the config payload for this channel. */
    toConfig(): ChannelConfig & { greeting?: string } {
        const cfg: ChannelConfig & { greeting?: string } = {};
        if (this.voice) cfg.voice = this.voice;
        if (this.language) cfg.language = this.language;
        if (this.stt) cfg.stt = this.stt;
        if (this.turnDetection) cfg.turnDetection = this.turnDetection;
        if (this.interruption !== undefined) cfg.interruption = this.interruption;
        if (this.config) cfg.config = this.config;
        // Include greeting for server-side LLM (only static strings; function greetings are client-side)
        if (typeof this.greeting === "string" && this.greeting) cfg.greeting = this.greeting;
        return cfg;
    }
}

// ─── Phone ───────────────────────────────────────────────────────────────

export class Phone extends Channel {
    override readonly type = "phone" as const;
    number = "";

    // Phone defaults: deepgram-flux (English, ultra-low latency) + native turn detection
    // (Flux has built-in end-of-turn detection, so "native" is the correct pairing).
    // Override either field in the constructor config or by subclassing.
    override stt: ChannelConfig["stt"] = "deepgram-flux";
    override turnDetection: ChannelConfig["turnDetection"] = "native";

    constructor(numberOrConfig?: string | (Partial<ChannelConfig> & { number?: string }), overrides?: Partial<ChannelConfig>) {
        super();
        if (typeof numberOrConfig === "string") {
            this.number = numberOrConfig;
            if (overrides) Object.assign(this, overrides);
        } else if (numberOrConfig) {
            _warnTypos(numberOrConfig);
            Object.assign(this, numberOrConfig);
        }
    }
}

/** @internal Warn about common config key typos so they don't silently get ignored. */
function _warnTypos(cfg: Record<string, unknown>): void {
    // Valid keys on Phone/Channel — never warn about these.
    const validKeys = new Set([
        "number", "voice", "language", "stt", "turnDetection",
        "interruption", "greeting", "config",
    ]);
    const typos: Record<string, string> = {
        sst: "stt",
        sts: "stt",
        turndetection: "turnDetection",
        turn_detection: "turnDetection",
        voiceid: "voice",
        voice_id: "voice",
    };
    for (const key of Object.keys(cfg)) {
        if (validKeys.has(key)) continue;
        const suggestion = typos[key] ?? typos[key.toLowerCase()];
        if (suggestion) {
            console.warn(
                `[Pinecall] Phone config: unknown key "${key}" — did you mean "${suggestion}"? ` +
                `The value was ignored.`,
            );
        }
    }
}

// ─── WebRTC ──────────────────────────────────────────────────────────────

export class WebRTC extends Channel {
    override readonly type = "webrtc" as const;

    constructor(overrides?: Partial<ChannelConfig>) {
        super();
        if (overrides) Object.assign(this, overrides);
    }
}
