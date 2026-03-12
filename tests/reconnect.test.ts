import { describe, it, expect } from "vitest";
import { Reconnector } from "../src/utils/reconnect";

describe("Reconnector", () => {
    it("calculates increasing delays with no jitter", () => {
        const r = new Reconnector({ initialDelay: 100, maxDelay: 10000, jitter: false });

        const d1 = r.nextDelay(); // attempt 0: 100
        expect(d1).toBe(100);

        const d2 = r.nextDelay(); // attempt 1: 200
        expect(d2).toBe(200);

        const d3 = r.nextDelay(); // attempt 2: 400
        expect(d3).toBe(400);
    });

    it("respects maxDelay", () => {
        const r = new Reconnector({ initialDelay: 1000, maxDelay: 2000, factor: 10, jitter: false });

        r.nextDelay(); // 1000
        const d = r.nextDelay(); // would be 10000 but capped at 2000
        expect(d).toBe(2000);
    });

    it("reset() returns to initial delay", () => {
        const r = new Reconnector({ initialDelay: 100, maxDelay: 10000, jitter: false });

        r.nextDelay(); // 100, attempt=1
        r.nextDelay(); // 200, attempt=2
        r.reset();
        const d = r.nextDelay();
        expect(d).toBe(100);
    });

    it("cancel() stops pending timer", () => {
        const r = new Reconnector({ initialDelay: 100, maxDelay: 10000, jitter: false });
        // Just verify cancel doesn't throw
        r.cancel();
    });

    it("tracks attempt count", () => {
        const r = new Reconnector({ initialDelay: 100, maxDelay: 10000, jitter: false });

        expect(r.attempt).toBe(0);
        r.nextDelay();
        expect(r.attempt).toBe(1);
        r.nextDelay();
        expect(r.attempt).toBe(2);
        r.reset();
        expect(r.attempt).toBe(0);
    });
});
