/**
 * Event handler attachment — registers all agent event listeners for the CLI UI.
 * Extracted from ui.ts:attach() (the 156-line function).
 */

import type { Agent, Call, Turn } from "@pinecall/sdk";
import chalk from "chalk";
import { BRAND, ACCENT, OK, ERR, WARN, MUTED, DIM, BAR, ARROW } from "./theme.js";
import { logLine, writeInline, ts, dur, write } from "./renderer.js";

// ── Per-call state ───────────────────────────────────────────────────────

interface CallState {
    startTime: number;
    speakingStart: number | null;
    userText: string;
}

const callStates = new Map<string, CallState>();

function getState(call: Call): CallState {
    let state = callStates.get(call.id);
    if (!state) {
        state = { startTime: Date.now(), speakingStart: null, userText: "" };
        callStates.set(call.id, state);
    }
    return state;
}

// ── Attach ────────────────────────────────────────────────────────────────

/**
 * Attach all event listeners to an agent for the CLI UI.
 *
 * @param agent - The agent to listen on.
 * @param onTurn - Optional callback for eager.turn events (for LLM streaming).
 */
export function attachEvents(
    agent: Agent,
    onTurn?: (turn: Turn, call: Call) => void,
): void {
    // ── Call lifecycle ──
    agent.on("call.started", (call: Call) => {
        getState(call);
        const dir = call.direction === "inbound" ? "incoming" : "outgoing";
        const from = call.direction === "inbound" ? call.from : call.to;
        write("\n");
        logLine(`${ts()} ${OK("call.started")} ${DIM(dir)} ${ACCENT(from)}`);
    });

    agent.on("call.ended", (call: Call, reason: string) => {
        const state = callStates.get(call.id);
        const elapsed = state ? ((Date.now() - state.startTime) / 1000).toFixed(1) + "s" : "";
        logLine(`${ts()} ${ERR("call.ended")} ${MUTED(reason)} ${DIM(elapsed)}`);
        callStates.delete(call.id);
        write("\n");
    });

    // ── Channel events ──
    agent.on("channel.added", (type: string, ref: string) => {
        logLine(`${ts()} ${OK("channel.added")} ${type} ${ACCENT(ref)}`);
    });

    // ── Speech events ──
    agent.on("speech.started", (_e, call: Call) => {
        const state = getState(call);
        state.speakingStart = Date.now();
    });

    agent.on("speech.ended", (_e, call: Call) => {
        const state = getState(call);
        if (state.speakingStart) {
            const d = Date.now() - state.speakingStart;
            state.speakingStart = null;
        }
    });

    // ── Transcript events ──
    agent.on("user.speaking", (e, _call: Call) => {
        writeInline(`  ${BAR} ${ts()} ${DIM("…")} ${MUTED(e.text)}`);
    });

    agent.on("user.message", (e, _call: Call) => {
        writeInline(`  ${BAR} ${ts()} ${chalk.white("user")} ${e.text}\n`);
    });

    // ── Turn events ──
    agent.on("eager.turn", (turn: Turn, call: Call) => {
        logLine(`${ts()} ${WARN("eager")} ${DIM("p=" + turn.probability.toFixed(2))} ${dur(turn.latencyMs)}`);
        if (onTurn) onTurn(turn, call);
    });

    agent.on("turn.end", (turn: Turn, _call: Call) => {
        logLine(`${ts()} ${OK("turn.end")} ${DIM("p=" + turn.probability.toFixed(2))} ${dur(turn.latencyMs)}`);
    });

    agent.on("turn.continued", () => {
        logLine(`${ts()} ${WARN("turn.continued")} ${DIM("user kept speaking")}`);
    });

    agent.on("turn.resumed", () => {
        logLine(`${ts()} ${DIM("turn.resumed")}`);
    });

    // ── Bot events ──
    agent.on("bot.speaking", (e, _call: Call) => {
        logLine(`${ts()} ${BRAND("bot")} ${e.text}`);
    });

    agent.on("bot.finished", (e, _call: Call) => {
        logLine(`${ts()} ${DIM("bot.finished")} ${dur(e.duration_ms)}`);
    });

    agent.on("bot.interrupted", (e, _call: Call) => {
        logLine(`${ts()} ${WARN("interrupted")} ${DIM(`after ${e.words_spoken} words`)}`);
    });

    // ── Reply events ──
    agent.on("message.confirmed", (e, _call: Call) => {
        logLine(`${ts()} ${OK("confirmed")} ${DIM(e.message_id.slice(0, 12))}`);
    });

    agent.on("reply.rejected", (e, _call: Call) => {
        logLine(`${ts()} ${ERR("rejected")} ${DIM(e.reason)} ${DIM(e.message_id.slice(0, 12))}`);
    });

    // ── Hold/Mute ──
    agent.on("call.held" as any, (_call: Call) => {
        logLine(`${ts()} ${MUTED("call held")}`);
    });

    agent.on("call.unheld" as any, (_call: Call) => {
        logLine(`${ts()} ${MUTED("call unheld")}`);
    });
}
