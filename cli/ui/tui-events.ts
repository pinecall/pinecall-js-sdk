/**
 * TUI event bindings — pipe agent events to the call events pane.
 *
 * Mirror of cli/ui/events.ts but routes output through sidebar.logCall()
 * instead of process.stdout.write(). Uses blessed {color-fg} tags.
 */

import type { Agent, Call, Turn } from "@pinecall/sdk";
import type {
    SpeechStartedEvent,
    SpeechEndedEvent,
    UserSpeakingEvent,
    UserMessageEvent,
    TurnPauseEvent,
    TurnContinuedEvent,
    TurnResumedEvent,
    BotWordEvent,
    BotFinishedEvent,
    BotInterruptedEvent,
    MessageConfirmedEvent,
    ReplyRejectedEvent,
} from "@pinecall/sdk";
import type { CallSidebar } from "./tui-sidebar.js";

// ── Per-call state ───────────────────────────────────────────────────────

interface CallState {
    startTime: number;
    speakingStart: number | null;
    botMsgId: string;
    botText: string;           // accumulated bot words for current message
    isSpeaking: boolean;       // true while user is speaking (interim updates)
}

const callStates = new Map<string, CallState>();

function getState(call: Call): CallState {
    let state = callStates.get(call.id);
    if (!state) {
        state = { startTime: Date.now(), speakingStart: null, botMsgId: "", botText: "", isSpeaking: false };
        callStates.set(call.id, state);
    }
    return state;
}

// ── Timestamp helper ─────────────────────────────────────────────────────

function ts(): string {
    return `{gray-fg}${new Date().toLocaleTimeString("en-US", { hour12: false })}{/gray-fg}`;
}

function dur(ms: number): string {
    if (ms >= 1000) return `{gray-fg}${(ms / 1000).toFixed(1)}s{/gray-fg}`;
    return `{gray-fg}${Math.round(ms)}ms{/gray-fg}`;
}

// ── Attach ────────────────────────────────────────────────────────────────

export function attachTUIEvents(
    agent: Agent,
    sidebar: CallSidebar,
    onTurn?: (turn: Turn, call: Call) => void,
): void {
    // ── Call lifecycle ──
    agent.on("call.started", (call: Call) => {
        getState(call);
        const dir = call.direction === "inbound" ? "incoming" : "outgoing";
        const from = call.direction === "inbound" ? call.from : call.to;
        sidebar.addCall(call.id, from);
        sidebar.logCall(call.id, `${ts()} {green-fg}call.started{/green-fg} ${dir} {cyan-fg}${from}{/cyan-fg}`);
    });

    agent.on("call.ended", (call: Call, reason: string) => {
        const state = callStates.get(call.id);
        const elapsed = state ? ((Date.now() - state.startTime) / 1000).toFixed(1) + "s" : "";
        sidebar.logCall(call.id, `${ts()} {red-fg}call.ended{/red-fg} {gray-fg}${reason} ${elapsed}{/gray-fg}`);
        sidebar.endCall(call.id);
        callStates.delete(call.id);
    });

    // ── Channel events ──
    agent.on("channel.added", (type: string, ref: string) => {
        // Channel events aren't call-scoped, log to first call or ignore
    });

    // ── Speech events ──
    agent.on("speech.started", (_e: SpeechStartedEvent, call: Call) => {
        const state = getState(call);
        state.speakingStart = Date.now();
    });

    agent.on("speech.ended", (_e: SpeechEndedEvent, call: Call) => {
        const state = getState(call);
        if (state.speakingStart) {
            state.speakingStart = null;
        }
    });

    // ── Transcript events ──
    agent.on("user.speaking", (e: UserSpeakingEvent, call: Call) => {
        const state = getState(call);
        const line = `${ts()} {gray-fg}… ${e.text}{/gray-fg}`;
        if (state.isSpeaking) {
            // Update the existing interim line in-place
            sidebar.updateLastCallLine(call.id, line);
        } else {
            state.isSpeaking = true;
            sidebar.logCall(call.id, line);
        }
    });

    agent.on("user.message", (e: UserMessageEvent, call: Call) => {
        const state = getState(call);
        const line = `${ts()} {white-fg}user{/white-fg} ${e.text}`;
        if (state.isSpeaking) {
            // Replace the interim line with the final transcript
            sidebar.updateLastCallLine(call.id, line);
            state.isSpeaking = false;
        } else {
            sidebar.logCall(call.id, line);
        }
    });

    // ── Turn events ──
    agent.on("eager.turn", (turn: Turn, call: Call) => {
        sidebar.logCall(call.id, `${ts()} {yellow-fg}eager{/yellow-fg} {gray-fg}p=${turn.probability.toFixed(2)}{/gray-fg} ${dur(turn.latencyMs)}`);
        if (onTurn) onTurn(turn, call);
    });

    agent.on("turn.end", (turn: Turn, _call: Call) => {
        sidebar.logCall(_call.id, `${ts()} {green-fg}turn.end{/green-fg} {gray-fg}p=${turn.probability.toFixed(2)}{/gray-fg} ${dur(turn.latencyMs)}`);
    });

    agent.on("turn.pause", (_e: TurnPauseEvent, call: Call) => {
        sidebar.logCall(call.id, `${ts()} {yellow-fg}turn.pause{/yellow-fg}`);
    });

    agent.on("turn.continued", (_e: TurnContinuedEvent, call: Call) => {
        sidebar.logCall(call.id, `${ts()} {gray-fg}turn.continued{/gray-fg}`);
    });

    agent.on("turn.resumed", (_e: TurnResumedEvent, call: Call) => {
        sidebar.logCall(call.id, `${ts()} {gray-fg}turn.resumed{/gray-fg}`);
    });

    // ── Bot events ──
    agent.on("bot.word", (e: BotWordEvent, call: Call) => {
        const state = getState(call);
        if (e.message_id !== state.botMsgId) {
            // New message — start fresh line
            state.botMsgId = e.message_id;
            state.botText = e.word;
            sidebar.logCall(call.id, `${ts()} {magenta-fg}bot{/magenta-fg} ${e.word}`);
        } else {
            // Same message — accumulate and update in-place
            state.botText += ` ${e.word}`;
            sidebar.updateLastCallLine(call.id, `${ts()} {magenta-fg}bot{/magenta-fg} ${state.botText}`);
        }
    });

    agent.on("bot.finished", (e: BotFinishedEvent, call: Call) => {
        const state = getState(call);
        state.botMsgId = "";
        state.botText = "";
        sidebar.logCall(call.id, `${ts()} {gray-fg}bot.finished{/gray-fg} ${dur(e.duration_ms)}`);
    });

    agent.on("bot.interrupted", (e: BotInterruptedEvent, call: Call) => {
        const state = getState(call);
        state.botMsgId = "";
        state.botText = "";
        sidebar.logCall(call.id, `${ts()} {yellow-fg}interrupted{/yellow-fg} {gray-fg}after ${e.words_spoken} words{/gray-fg}`);
    });

    // ── Reply events ──
    agent.on("message.confirmed", (e: MessageConfirmedEvent, call: Call) => {
        sidebar.logCall(call.id, `${ts()} {green-fg}✓ confirmed{/green-fg} {gray-fg}${e.message_id.slice(0, 12)}{/gray-fg}`);
    });

    agent.on("reply.rejected", (e: ReplyRejectedEvent, call: Call) => {
        sidebar.logCall(call.id, `${ts()} {red-fg}✗ rejected{/red-fg} {gray-fg}${e.reason} ${e.message_id.slice(0, 12)}{/gray-fg}`);
    });

    // ── Hold/Mute ──
    agent.on("call.held" as any, (call: Call) => {
        sidebar.logCall(call.id, `${ts()} {gray-fg}call held{/gray-fg}`);
    });

    agent.on("call.unheld" as any, (call: Call) => {
        sidebar.logCall(call.id, `${ts()} {gray-fg}call unheld{/gray-fg}`);
    });
}
