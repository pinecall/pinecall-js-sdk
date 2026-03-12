/**
 * Protocol utilities — serialization helpers for the Pinecall WebSocket protocol.
 *
 * Moved from agent.ts to eliminate the circular dependency smell
 * where client.ts imported a utility from agent.ts.
 */

import type { AgentConfig, ChannelConfig } from "../agent.js";

type ShortcutInput = AgentConfig | ChannelConfig | undefined;

/**
 * Convert SDK shortcut fields to protocol payload.
 *
 * Transforms camelCase SDK config into the snake_case wire format:
 *   { voice: "elevenlabs:abc", turnDetection: "smart_turn" }
 *   → { voice: "elevenlabs:abc", turn_detection: "smart_turn" }
 */
export function buildShortcutPayload(opts?: ShortcutInput): Record<string, unknown> {
    if (!opts) return {};
    const payload: Record<string, unknown> = {};

    if (opts.voice !== undefined) payload.voice = opts.voice;
    if (opts.language !== undefined) payload.language = opts.language;
    if (opts.stt !== undefined) payload.stt = opts.stt;
    if (opts.turnDetection !== undefined) payload.turn_detection = opts.turnDetection;
    if (opts.interruption !== undefined) payload.interruption = opts.interruption;
    if (opts.config !== undefined) payload.config = opts.config;
    if ("mode" in opts && (opts as Record<string, unknown>).mode !== undefined) {
        payload.mode = (opts as Record<string, unknown>).mode;
    }

    return payload;
}
