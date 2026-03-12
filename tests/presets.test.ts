import { describe, it, expect } from "vitest";
import { getPreset, presets } from "../cli/lib/presets";
import { CliError } from "../cli/lib/errors";

describe("getPreset", () => {
    it("returns English preset", () => {
        const p = getPreset("en");
        expect(p.voice).toContain("elevenlabs");
        expect(p.greeting).toContain("How can I help");
    });

    it("returns Spanish preset", () => {
        const p = getPreset("es");
        expect(p.voice).toContain("elevenlabs");
        expect(p.greeting).toContain("Hola");
    });

    it("throws CliError for unknown language", () => {
        expect(() => getPreset("xx")).toThrow(CliError);
        expect(() => getPreset("xx")).toThrow(/Unknown language/);
    });
});
