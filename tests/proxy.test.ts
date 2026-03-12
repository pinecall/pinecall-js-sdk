import { describe, it, expect, vi } from "vitest";
import { forwardCallEvents, forwardAgentEvents, CALL_PROXY_EVENTS } from "../src/utils/proxy";
import { TypedEmitter } from "../src/utils/emitter";

// Minimal emitter subclass that exposes emit
class TestEmitter extends TypedEmitter<any> {
    fire(event: string, ...args: unknown[]) {
        this.emit(event, ...args);
    }
}

describe("forwardCallEvents", () => {
    it("forwards all CALL_PROXY_EVENTS from source to target with context", () => {
        const source = new TestEmitter();
        const target = new TestEmitter();
        const context = { id: "call_123" };
        const received: Array<{ event: string; args: unknown[] }> = [];

        forwardCallEvents(source, target, context);

        // Listen on target for all proxied events
        for (const event of CALL_PROXY_EVENTS) {
            target.on(event, (...args: unknown[]) => {
                received.push({ event, args });
            });
        }

        // Fire one event on source
        source.fire("eager.turn", { text: "hello" });

        expect(received).toHaveLength(1);
        expect(received[0].event).toBe("eager.turn");
        expect(received[0].args).toEqual([{ text: "hello" }, context]);
    });
});

describe("forwardAgentEvents", () => {
    it("forwards call.started and call.ended from agent to pinecall", () => {
        const agent = new TestEmitter();
        const pc = new TestEmitter();
        const received: string[] = [];

        forwardAgentEvents(agent, pc);

        pc.on("call.started", () => received.push("started"));
        pc.on("call.ended", () => received.push("ended"));

        agent.fire("call.started", { id: "c1" });
        agent.fire("call.ended", { id: "c1" }, "hangup");

        expect(received).toEqual(["started", "ended"]);
    });

    it("forwards CALL_PROXY_EVENTS passthrough", () => {
        const agent = new TestEmitter();
        const pc = new TestEmitter();

        forwardAgentEvents(agent, pc);

        let received = false;
        pc.on("bot.speaking", () => { received = true; });
        agent.fire("bot.speaking", { text: "hi" }, { id: "c1" });

        expect(received).toBe(true);
    });
});
