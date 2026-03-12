import { describe, it, expect } from "vitest";
import { TypedEmitter } from "../src/utils/emitter";

// Simple event map for testing
interface TestEvents {
    greet: (name: string) => void;
    count: (n: number) => void;
    [key: string]: (...args: any[]) => void;
}

describe("TypedEmitter", () => {
    it("emits events to listeners", () => {
        const emitter = new (class extends TypedEmitter<TestEvents> {
            fire(event: string, ...args: unknown[]) {
                this.emit(event as any, ...args as any);
            }
        })();

        const received: string[] = [];
        emitter.on("greet", (name) => received.push(name));
        emitter.fire("greet", "Alice");
        emitter.fire("greet", "Bob");

        expect(received).toEqual(["Alice", "Bob"]);
    });

    it("once() only fires once", () => {
        const emitter = new (class extends TypedEmitter<TestEvents> {
            fire(event: string, ...args: unknown[]) {
                this.emit(event as any, ...args as any);
            }
        })();

        let count = 0;
        emitter.once("count", () => count++);
        emitter.fire("count", 1);
        emitter.fire("count", 2);

        expect(count).toBe(1);
    });

    it("off() removes a specific listener", () => {
        const emitter = new (class extends TypedEmitter<TestEvents> {
            fire(event: string, ...args: unknown[]) {
                this.emit(event as any, ...args as any);
            }
        })();

        const received: string[] = [];
        const handler = (name: string) => received.push(name);

        emitter.on("greet", handler);
        emitter.fire("greet", "Alice");
        emitter.off("greet", handler);
        emitter.fire("greet", "Bob");

        expect(received).toEqual(["Alice"]);
    });

    it("removeAllListeners() clears everything", () => {
        const emitter = new (class extends TypedEmitter<TestEvents> {
            fire(event: string, ...args: unknown[]) {
                this.emit(event as any, ...args as any);
            }
        })();

        let called = false;
        emitter.on("greet", () => { called = true; });
        emitter.removeAllListeners();
        emitter.fire("greet", "test");

        expect(called).toBe(false);
    });

    it("handler errors do not break other listeners", () => {
        const emitter = new (class extends TypedEmitter<TestEvents> {
            fire(event: string, ...args: unknown[]) {
                this.emit(event as any, ...args as any);
            }
        })();

        const received: string[] = [];
        emitter.on("greet", () => { throw new Error("boom"); });
        emitter.on("greet", (name) => received.push(name));

        // Should not throw
        emitter.fire("greet", "Alice");

        // Second handler still runs
        expect(received).toEqual(["Alice"]);
    });
});
