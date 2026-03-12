import { describe, it, expect } from "vitest";
import { parseArgs } from "../cli/lib/args";

describe("parseArgs", () => {
    it("parses flags", () => {
        const args = parseArgs(["--es", "--verbose"], {
            flags: ["--es", "--verbose"],
        });
        expect(args.flags.has("--es")).toBe(true);
        expect(args.flags.has("--verbose")).toBe(true);
    });

    it("parses key=value args", () => {
        const args = parseArgs(["--lang=es", "--provider=cartesia"], {
            values: ["--lang", "--provider"],
        });
        expect(args.values.get("--lang")).toBe("es");
        expect(args.values.get("--provider")).toBe("cartesia");
    });

    it("parses positional args", () => {
        const args = parseArgs(["+12025551234", "--es"], {
            flags: ["--es"],
            positional: "to",
        });
        expect(args.positional).toBe("+12025551234");
        expect(args.flags.has("--es")).toBe(true);
    });

    it("ignores unknown flags", () => {
        const args = parseArgs(["--unknown", "--es"], {
            flags: ["--es"],
        });
        expect(args.flags.has("--es")).toBe(true);
        expect(args.flags.has("--unknown")).toBe(false);
    });

    it("handles empty argv", () => {
        const args = parseArgs([], {});
        expect(args.flags.size).toBe(0);
        expect(args.values.size).toBe(0);
        expect(args.positional).toBeUndefined();
    });
});
