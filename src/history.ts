/**
 * ConversationHistory — tracks messages with interruption handling.
 *
 * Automatically wires to Call events to maintain correct history
 * per the Pinecall protocol:
 *
 *   user.message       → addUser()
 *   bot.finished       → addAssistant()
 *   bot.interrupted    → markInterrupted() or discard()
 *   turn.continued     → removeLastUser()
 */

import type { Call } from "./call.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
    /** Internal tracking ID (message_id from the protocol). */
    messageId?: string;
    /** Additional properties (e.g. tool_call_id). */
    [key: string]: unknown;
}

// ─── ConversationHistory ─────────────────────────────────────────────────

export class ConversationHistory {
    private _messages: ChatMessage[] = [];
    /** Tracks bot text from bot.speaking events for history on bot.finished. */
    private _pendingBotText = new Map<string, string>();

    /** Optional hook — fires on every mutation. */
    onUpdate?: (messages: ChatMessage[]) => void;

    // ── Read ─────────────────────────────────────────────────────────────

    get messages(): ReadonlyArray<ChatMessage> {
        return this._messages;
    }

    get length(): number {
        return this._messages.length;
    }

    /** Return messages in OpenAI format (role + content only). */
    toMessages(): Array<{ role: string; content: string }> {
        return this._messages.map((m) => ({ role: m.role, content: m.content }));
    }

    // ── Write ────────────────────────────────────────────────────────────

    addSystem(text: string): void {
        this._messages.push({ role: "system", content: text });
        this._notify();
    }

    addUser(text: string, messageId?: string): void {
        this._messages.push({ role: "user", content: text, messageId });
        this._notify();
    }

    addAssistant(text: string, messageId?: string): void {
        if (!text) return; // skip empty
        // Skip duplicate by messageId
        if (messageId && this._messages.some(m => m.role === "assistant" && m.messageId === messageId)) return;
        this._messages.push({ role: "assistant", content: text, messageId });
        this._notify();
    }

    // ── Interruption protocol ────────────────────────────────────────────

    /**
     * Mark an assistant message as interrupted (reason="user_spoke").
     * Appends `[interrupted]` to the content.
     */
    markInterrupted(messageId: string): void {
        const msg = this._findByMessageId(messageId);
        if (msg && msg.role === "assistant" && !msg.content.endsWith("[interrupted]")) {
            msg.content += " [interrupted]";
            this._notify();
        }
    }

    /**
     * Discard a message entirely (reason="continuation").
     * The message was interrupted so early it should not be in history.
     */
    discard(messageId: string): void {
        const idx = this._messages.findIndex((m) => m.messageId === messageId);
        if (idx !== -1) {
            this._messages.splice(idx, 1);
            this._notify();
        }
    }

    /**
     * Remove the last user message (turn.continued).
     * The text will be re-sent with an updated transcript.
     */
    removeLastUser(): void {
        for (let i = this._messages.length - 1; i >= 0; i--) {
            if (this._messages[i].role === "user") {
                this._messages.splice(i, 1);
                this._notify();
                return;
            }
        }
    }

    /** Clear all messages. */
    clear(): void {
        this._messages = [];
        this._notify();
    }

    // ── Serialization ────────────────────────────────────────────────────

    toJSON(): string {
        return JSON.stringify(this._messages);
    }

    static fromJSON(json: string): ConversationHistory {
        const history = new ConversationHistory();
        history._messages = JSON.parse(json);
        return history;
    }

    // ── Auto-wire to a Call ──────────────────────────────────────────────

    /**
     * Create a ConversationHistory that automatically tracks events
     * from a Call. Optionally seeds with a system prompt.
     */
    static forCall(call: Call, systemPrompt?: string): ConversationHistory {
        const history = new ConversationHistory();

        if (systemPrompt) {
            history.addSystem(systemPrompt);
        }

        call.on("user.message", (event) => {
            history.addUser(event.text, event.message_id);
        });

        call.on("bot.speaking", (event) => {
            history._pendingBotText.set(event.message_id, event.text);
        });

        call.on("bot.finished", (event) => {
            const text = history._pendingBotText.get(event.message_id);
            if (text) {
                history.addAssistant(text, event.message_id);
                history._pendingBotText.delete(event.message_id);
            }
        });

        call.on("bot.interrupted", (event) => {
            const text = history._pendingBotText.get(event.message_id);
            history._pendingBotText.delete(event.message_id);
            if (event.reason === "user_spoke" && text) {
                // Add partial text with [interrupted] marker
                history.addAssistant(text, event.message_id);
                history.markInterrupted(event.message_id);
            } else if (event.reason === "continuation") {
                history.discard(event.message_id);
            }
        });

        call.on("turn.continued", () => {
            history.removeLastUser();
        });

        return history;
    }

    // ── Private ──────────────────────────────────────────────────────────

    private _findByMessageId(messageId: string): ChatMessage | undefined {
        for (let i = this._messages.length - 1; i >= 0; i--) {
            if (this._messages[i].messageId === messageId) return this._messages[i];
        }
        return undefined;
    }

    private _notify(): void {
        this.onUpdate?.(this._messages);
    }
}
