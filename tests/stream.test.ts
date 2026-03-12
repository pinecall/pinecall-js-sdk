import { describe, it, expect, vi } from "vitest";
import { ReplyStream } from "../src/stream";

function createStream(overrides?: Partial<ConstructorParameters<typeof ReplyStream>[0]>) {
    const send = vi.fn();
    const onComplete = vi.fn();
    const stream = new ReplyStream({
        callId: "call_123",
        inReplyTo: "msg_abc",
        send,
        onComplete,
        ...overrides,
    });
    return { stream, send, onComplete };
}

describe("ReplyStream", () => {
    it("sends start → chunk → end frames", () => {
        const { stream, send } = createStream();

        stream.write("Hello ");
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({ event: "bot.reply.stream", action: "start" }),
        );
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({ action: "chunk", token: "Hello " }),
        );

        stream.write("world");
        stream.end();

        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({ action: "end" }),
        );
    });

    it("end() on empty stream sends start+end", () => {
        const { stream, send } = createStream();

        stream.end();

        const calls = send.mock.calls.map((c) => (c[0] as any).action);
        expect(calls).toEqual(["start", "end"]);
    });

    it("write() is a no-op after end()", () => {
        const { stream, send } = createStream();

        stream.write("first");
        stream.end();
        const countBefore = send.mock.calls.length;

        stream.write("after-end");
        expect(send.mock.calls.length).toBe(countBefore);
    });

    it("abort() stops writes and fires AbortSignal", () => {
        const { stream, send } = createStream();

        stream.write("first");
        stream.abort();

        expect(stream.aborted).toBe(true);
        expect(stream.signal.aborted).toBe(true);

        const countBefore = send.mock.calls.length;
        stream.write("after-abort");
        expect(send.mock.calls.length).toBe(countBefore);
    });

    it("calls onComplete on end()", () => {
        const { stream, onComplete } = createStream();

        stream.write("hello");
        stream.end();

        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("calls onComplete on abort()", () => {
        const { stream, onComplete } = createStream();

        stream.write("hello");
        stream.abort();

        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("onComplete is called only once even if end() and abort() are both called", () => {
        const { stream, onComplete } = createStream();

        stream.end();
        stream.abort();

        expect(onComplete).toHaveBeenCalledTimes(1);
    });
});
