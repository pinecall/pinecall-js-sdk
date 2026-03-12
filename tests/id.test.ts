import { describe, it, expect } from "vitest";
import { generateId } from "../src/utils/id";

describe("generateId", () => {
    it("generates an ID with the default prefix", () => {
        const id = generateId();
        expect(id).toMatch(/^msg_[a-z0-9]{12}$/);
    });

    it("uses a custom prefix", () => {
        const id = generateId("stream");
        expect(id).toMatch(/^stream_[a-z0-9]{12}$/);
    });

    it("generates unique IDs", () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateId()));
        expect(ids.size).toBe(100);
    });
});
