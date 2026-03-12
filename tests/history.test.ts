import { describe, it, expect, beforeEach } from "vitest";
import { ConversationHistory } from "../src/history.js";

describe("ConversationHistory", () => {
    let history: ConversationHistory;

    beforeEach(() => {
        history = new ConversationHistory();
    });

    // ── Basic operations ─────────────────────────────────────────────────

    it("starts empty", () => {
        expect(history.length).toBe(0);
        expect(history.toMessages()).toEqual([]);
    });

    it("adds system, user, and assistant messages", () => {
        history.addSystem("You are helpful.");
        history.addUser("Hello", "msg_1");
        history.addAssistant("Hi!", "msg_2");

        expect(history.length).toBe(3);

        const msgs = history.toMessages();
        expect(msgs).toEqual([
            { role: "system", content: "You are helpful." },
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi!" },
        ]);
    });

    // ── Interruption protocol ────────────────────────────────────────────

    it("markInterrupted appends [interrupted] to assistant message", () => {
        history.addAssistant("I can help!", "msg_1");
        history.markInterrupted("msg_1");

        const msgs = history.toMessages();
        expect(msgs[0].content).toBe("I can help! [interrupted]");
    });

    it("markInterrupted does not double-tag", () => {
        history.addAssistant("Sure!", "msg_1");
        history.markInterrupted("msg_1");
        history.markInterrupted("msg_1");

        expect(history.messages[0].content).toBe("Sure! [interrupted]");
    });

    it("markInterrupted ignores non-assistant messages", () => {
        history.addUser("Hello", "msg_1");
        history.markInterrupted("msg_1");

        expect(history.messages[0].content).toBe("Hello");
    });

    it("discard removes a message by messageId", () => {
        history.addAssistant("Sure!", "msg_1");
        history.addUser("Thanks", "msg_2");

        history.discard("msg_1");

        expect(history.length).toBe(1);
        expect(history.messages[0].content).toBe("Thanks");
    });

    it("removeLastUser removes the last user message", () => {
        history.addSystem("System prompt");
        history.addUser("First", "msg_1");
        history.addAssistant("Reply", "msg_2");
        history.addUser("Second", "msg_3");

        history.removeLastUser();

        expect(history.length).toBe(3);
        expect(history.toMessages()).toEqual([
            { role: "system", content: "System prompt" },
            { role: "user", content: "First" },
            { role: "assistant", content: "Reply" },
        ]);
    });

    it("removeLastUser does nothing when no user messages exist", () => {
        history.addSystem("Prompt");
        history.removeLastUser();
        expect(history.length).toBe(1);
    });

    // ── Clear ────────────────────────────────────────────────────────────

    it("clear removes all messages", () => {
        history.addSystem("System");
        history.addUser("Hello", "msg_1");
        history.addAssistant("Hi", "msg_2");

        history.clear();

        expect(history.length).toBe(0);
    });

    // ── onUpdate hook ────────────────────────────────────────────────────

    it("fires onUpdate callback on mutations", () => {
        let callCount = 0;
        history.onUpdate = () => { callCount++; };

        history.addUser("Hello");
        history.addAssistant("Hi");
        history.removeLastUser();
        history.clear();

        expect(callCount).toBe(4);
    });

    // ── Serialization ────────────────────────────────────────────────────

    it("toJSON / fromJSON roundtrips", () => {
        history.addSystem("System");
        history.addUser("Hello", "msg_1");
        history.addAssistant("Hi!", "msg_2");

        const json = history.toJSON();
        const restored = ConversationHistory.fromJSON(json);

        expect(restored.length).toBe(3);
        expect(restored.toMessages()).toEqual(history.toMessages());
    });

    // ── Full interruption scenario ───────────────────────────────────────

    it("handles a full conversation with interruption", () => {
        // System prompt
        history.addSystem("You are a receptionist.");

        // Turn 1: user speaks
        history.addUser("I'd like to book a table", "usr_1");

        // Bot starts replying
        history.addAssistant("Sure! Let me help you with that booking.", "bot_1");

        // Bot gets interrupted after speaking for 2+ seconds
        history.markInterrupted("bot_1");

        // Turn 2: user continues (turn.continued fires)
        history.removeLastUser(); // Remove "I'd like to book a table"

        // Updated transcript
        history.addUser("I'd like to book a table for two at 7pm", "usr_2");

        const msgs = history.toMessages();
        expect(msgs).toEqual([
            { role: "system", content: "You are a receptionist." },
            { role: "assistant", content: "Sure! Let me help you with that booking. [interrupted]" },
            { role: "user", content: "I'd like to book a table for two at 7pm" },
        ]);
    });

    it("handles continuation interruption (discard)", () => {
        history.addSystem("Prompt");
        history.addUser("Hello", "usr_1");

        // Bot starts but gets interrupted immediately (< 2s)
        history.addAssistant("Sur-", "bot_1");
        history.discard("bot_1"); // reason=continuation → don't add to history

        expect(history.toMessages()).toEqual([
            { role: "system", content: "Prompt" },
            { role: "user", content: "Hello" },
        ]);
    });
});
