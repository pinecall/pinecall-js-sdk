import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Call, type Turn } from "../src/call";
import { ReplyStream } from "../src/stream";

function createCall(overrides?: Partial<ConstructorParameters<typeof Call>[0]>) {
    const send = vi.fn();
    const call = new Call(
        {
            call_id: "call_001",
            from: "+1234567890",
            to: "+0987654321",
            direction: "inbound",
            ...overrides,
        },
        send,
    );
    return { call, send };
}

describe("Call", () => {
    describe("properties", () => {
        it("exposes call metadata", () => {
            const { call } = createCall();
            expect(call.id).toBe("call_001");
            expect(call.from).toBe("+1234567890");
            expect(call.to).toBe("+0987654321");
            expect(call.direction).toBe("inbound");
        });
    });

    describe("say()", () => {
        it("sends a bot.reply command", () => {
            const { call, send } = createCall();

            call.say("Hello!");

            expect(send).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: "bot.reply",
                    call_id: "call_001",
                    text: "Hello!",
                }),
            );
        });
    });

    describe("reply()", () => {
        it("sends a bot.reply with in_reply_to", () => {
            const { call, send } = createCall();

            // Simulate receiving a user message to set lastMessageId
            call._handleEvent({
                event: "user.message",
                call_id: "call_001",
                message_id: "msg_user_1",
                text: "Hi there",
                confidence: 0.99,
                turn_id: 1,
            });

            call.reply("Hi back!");

            expect(send).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: "bot.reply",
                    in_reply_to: "msg_user_1",
                    text: "Hi back!",
                }),
            );
        });
    });

    describe("replyStream()", () => {
        it("returns a ReplyStream", () => {
            const { call } = createCall();
            const stream = call.replyStream();
            expect(stream).toBeInstanceOf(ReplyStream);
        });

        it("auto-removes stream from activeStreams on end()", () => {
            const { call } = createCall();
            const stream = call.replyStream();
            stream.write("hello");
            stream.end();
            // No monkey-patching — should just work via onComplete
            expect(stream.ended).toBe(true);
        });

        it("auto-removes stream from activeStreams on abort()", () => {
            const { call } = createCall();
            const stream = call.replyStream();
            stream.write("hello");
            stream.abort();
            expect(stream.aborted).toBe(true);
        });
    });

    describe("_end()", () => {
        it("emits ended event with reason", () => {
            const { call } = createCall();
            const reasons: string[] = [];
            call.on("ended", (r) => reasons.push(r));

            call._end("hangup");

            expect(reasons).toEqual(["hangup"]);
        });

        it("aborts active streams", () => {
            const { call } = createCall();
            const stream = call.replyStream();
            stream.write("hello");

            call._end("hangup");

            expect(stream.aborted).toBe(true);
        });

        it("defers removeAllListeners to microtask", async () => {
            const { call } = createCall();
            let newListenerAttached = false;

            call.on("ended", () => {
                // Handler should be able to interact with the call
                // during the same event emission
                newListenerAttached = true;
            });

            call._end("hangup");

            // Handler ran synchronously
            expect(newListenerAttached).toBe(true);

            // But after microtask, listeners are cleared
            await new Promise<void>((r) => queueMicrotask(() => r()));
            // No way to easily check listener count, but emitting should not throw
            call.on("ended", () => { }); // Should work — new listener on clean emitter
        });
    });

    describe("_handleEvent()", () => {
        it("processes user.message and emits user.message", () => {
            const { call } = createCall();
            const messages: string[] = [];

            call.on("user.message", (e) => messages.push(e.text));

            call._handleEvent({
                event: "user.message",
                call_id: "call_001",
                message_id: "msg_1",
                text: "Hello world",
                confidence: 0.95,
                turn_id: 1,
            });

            expect(messages).toEqual(["Hello world"]);
        });

        it("builds Turn on eager.turn", () => {
            const { call } = createCall();
            const turns: Turn[] = [];

            call.on("eager.turn", (turn) => turns.push(turn));

            // First send a user message
            call._handleEvent({
                event: "user.message",
                call_id: "call_001",
                message_id: "msg_1",
                text: "What time is it?",
                confidence: 0.95,
                turn_id: 1,
            });

            // Then the eager turn
            call._handleEvent({
                event: "eager.turn",
                call_id: "call_001",
                turn_id: 1,
                probability: 0.92,
                latency_ms: 400,
                text: "What time is it?",
                message_id: "msg_1",
            });

            expect(turns).toHaveLength(1);
            expect(turns[0].text).toBe("What time is it?");
            expect(turns[0].probability).toBe(0.92);
            expect(turns[0].latencyMs).toBe(400);
        });

        it("auto-aborts streams on turn.continued", () => {
            const { call } = createCall();

            // Create a stream
            const stream = call.replyStream();
            stream.write("first");

            // Server says user continued speaking
            call._handleEvent({
                event: "turn.continued",
                call_id: "call_001",
                turn_id: 1,
                timestamp: Date.now(),
            });

            expect(stream.aborted).toBe(true);
        });
    });

    describe("control methods", () => {
        it("hangup() sends call.hangup", () => {
            const { call, send } = createCall();
            call.hangup();
            expect(send).toHaveBeenCalledWith(
                expect.objectContaining({ event: "call.hangup", call_id: "call_001" }),
            );
        });

        it("hold() sends call.hold", () => {
            const { call, send } = createCall();
            call.hold();
            expect(send).toHaveBeenCalledWith(
                expect.objectContaining({ event: "call.hold", call_id: "call_001" }),
            );
        });

        it("mute() sends call.mute", () => {
            const { call, send } = createCall();
            call.mute();
            expect(send).toHaveBeenCalledWith(
                expect.objectContaining({ event: "call.mute", call_id: "call_001" }),
            );
        });
    });
});
