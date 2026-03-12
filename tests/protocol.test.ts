import { describe, it, expect, vi } from "vitest";
import { buildShortcutPayload } from "../src/utils/protocol";

describe("buildShortcutPayload", () => {
    it("returns empty object for undefined input", () => {
        expect(buildShortcutPayload()).toEqual({});
        expect(buildShortcutPayload(undefined)).toEqual({});
    });

    it("maps camelCase to snake_case", () => {
        const result = buildShortcutPayload({
            voice: "elevenlabs:abc",
            turnDetection: "smart_turn",
            stt: { provider: "deepgram", language: "es" } as any,
        });

        expect(result.voice).toBe("elevenlabs:abc");
        expect(result.turn_detection).toBe("smart_turn");
        expect(result.stt).toEqual({ provider: "deepgram", language: "es" });
    });

    it("omits undefined fields", () => {
        const result = buildShortcutPayload({ voice: "cartesia:xyz" });

        expect(result.voice).toBe("cartesia:xyz");
        expect(result).not.toHaveProperty("language");
        expect(result).not.toHaveProperty("stt");
        expect(result).not.toHaveProperty("turn_detection");
    });

    it("includes language when specified", () => {
        const result = buildShortcutPayload({ language: "es" });
        expect(result.language).toBe("es");
    });

    it("includes interruption config", () => {
        const result = buildShortcutPayload({ interruption: true } as any);
        expect(result.interruption).toBe(true);
    });

    it("includes config passthrough", () => {
        const config = { maxTokens: 100 };
        const result = buildShortcutPayload({ config } as any);
        expect(result.config).toBe(config);
    });
});
