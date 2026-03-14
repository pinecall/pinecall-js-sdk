/**
 * Event handler attachment — registers all agent event listeners for the CLI UI.
 *
 * ALL events go to a single stdout log stream with clear visual sections.
 *
 * Visual language:
 *   🎙️  user transcript              ← user speech
 *   🔊  bot playback text            ← bot TTS
 *   ┊   LLM streaming tokens         ← LLM section (purple dotted bar)
 *   ━━━ GPT model ━━━               ← LLM section header/footer
 *   ┈┈┈ call.started ┈┈┈            ← call lifecycle markers
 */

import type { Agent, Call, Turn } from "@pinecall/sdk";
import type OpenAI from "openai";
import chalk from "chalk";
import { BRAND, ACCENT, OK, ERR, WARN, MUTED, DIM, BAR } from "./theme.js";
import { logLine, writeInline, writeln, ts, dur, write } from "./renderer.js";

// ── Visual constants ─────────────────────────────────────────────────────

const LLM_BAR = chalk.hex("#9d4edd")("┊");
const SEP_WIDTH = 50;

/** Write a line with the LLM dotted bar prefix. */
function llmLine(msg: string): void {
    writeln(`  ${LLM_BAR}   ${msg}`);
}

/** Labeled separator (e.g. ┈┈┈ call.started ┈┈┈). */
function labeledSep(label: string): void {
    const pad = Math.max(2, Math.floor((SEP_WIDTH - label.length - 2) / 2));
    const line = MUTED("┈".repeat(pad));
    writeln(`  ${line} ${MUTED(label)} ${line}`);
}

/** LLM section header (e.g. ━━━ GPT gpt-4.1-nano ━━━). */
function llmHeader(label: string): void {
    const pad = Math.max(2, Math.floor((SEP_WIDTH - label.length - 2) / 2));
    const line = chalk.hex("#444")("━".repeat(pad));
    if (label) {
        writeln(`  ${line} ${chalk.hex("#9d4edd").bold(label)} ${line}`);
    } else {
        writeln(`  ${chalk.hex("#444")("━".repeat(SEP_WIDTH))}`);
    }
}

// ── Module-level streaming flag ──────────────────────────────────────────

let _llmStreaming = false;
let _llmStreamStarted = false;

function breakStream(): void {
    if (_llmStreaming && _llmStreamStarted) {
        write("\n");
        _llmStreamStarted = false;
    }
}

function ensureStreamPrefix(): void {
    if (!_llmStreamStarted) {
        write(`  ${LLM_BAR}   `);
        _llmStreamStarted = true;
    }
}

// ── Call registry (shared with commands) ─────────────────────────────────

interface CallEntry {
    call: Call;
    index: number;
    startTime: number;
    speakingStart: number | null;
}

let _nextIndex = 1;
const _calls = new Map<string, CallEntry>();
let _selectedCallId: string | null = null;

function getEntry(call: Call): CallEntry {
    let entry = _calls.get(call.id);
    if (!entry) {
        entry = { call, index: _nextIndex++, startTime: Date.now(), speakingStart: null };
        _calls.set(call.id, entry);
        if (_calls.size === 1) _selectedCallId = call.id;
    }
    return entry;
}

function removeCall(callId: string): void {
    _calls.delete(callId);
    if (_selectedCallId === callId) {
        const remaining = [..._calls.values()][0];
        _selectedCallId = remaining ? remaining.call.id : null;
    }
}

/** Call label prefix — only shown when >1 call active. */
function callPrefix(call: Call): string {
    if (_calls.size <= 1) return "";
    const entry = _calls.get(call.id);
    if (!entry) return "";
    const sel = call.id === _selectedCallId ? chalk.hex("#c084fc")("▸") : " ";
    return `${sel}${DIM(`[${entry.index}]`)} `;
}

// ── Exported for command access ──

export function getActiveCalls(): ReadonlyMap<string, CallEntry> { return _calls; }

export function getSelectedCall(): Call | null {
    if (!_selectedCallId) return null;
    return _calls.get(_selectedCallId)?.call ?? null;
}

export function selectCall(indexOrSid: string): Call | null {
    const num = parseInt(indexOrSid, 10);
    if (!isNaN(num)) {
        for (const entry of _calls.values()) {
            if (entry.index === num) { _selectedCallId = entry.call.id; return entry.call; }
        }
    }
    const lower = indexOrSid.toLowerCase();
    for (const entry of _calls.values()) {
        if (entry.call.id.toLowerCase().startsWith(lower)) {
            _selectedCallId = entry.call.id;
            return entry.call;
        }
    }
    return null;
}

export function getCallLabel(call: Call): string {
    const entry = _calls.get(call.id);
    return entry ? `[${entry.index}]` : "";
}

// ── Attach core events ───────────────────────────────────────────────────

export function attachEvents(
    agent: Agent,
    onTurn?: (turn: Turn, call: Call) => void,
): void {
    // ── Call lifecycle ──
    agent.on("call.started", (call: Call) => {
        const entry = getEntry(call);
        const dir = call.direction === "inbound" ? "incoming" : "outgoing";
        const from = call.direction === "inbound" ? call.from : call.to;
        breakStream();
        write("\n");
        labeledSep(`call.started ${DIM(`[${entry.index}]`)}`);
        logLine(`${callPrefix(call)}${ts()} ${DIM(dir)} ${ACCENT(from)}`);
        write("\n");
    });

    agent.on("call.ended", (call: Call, reason: string) => {
        breakStream();
        const entry = _calls.get(call.id);
        const elapsed = entry ? ((Date.now() - entry.startTime) / 1000).toFixed(1) + "s" : "";
        write("\n");
        labeledSep(`call.ended ${getCallLabel(call)}`);
        logLine(`${callPrefix(call)}${ts()} ${MUTED(reason)} ${DIM("·")} ${DIM(elapsed)}`);
        write("\n");
        removeCall(call.id);
    });

    // ── Channel events ──
    agent.on("channel.added", (type: string, ref: string) => {
        logLine(`${ts()} ${OK("channel.added")} ${type} ${ACCENT(ref)}`);
    });

    // ── Speech events (silent — just track state) ──
    agent.on("speech.started", (_e: any, call: Call) => {
        const entry = getEntry(call);
        entry.speakingStart = Date.now();
    });

    agent.on("speech.ended", (_e: any, call: Call) => {
        const entry = getEntry(call);
        if (entry.speakingStart) entry.speakingStart = null;
    });

    // ── Transcript events ──
    agent.on("user.speaking", (e: any, _call: Call) => {
        if (_llmStreaming) return;
        writeInline(`  ${BAR} ${callPrefix(_call)}${ts()} ${DIM("…")} ${MUTED(e.text)}`);
    });

    agent.on("user.message", (e: any, _call: Call) => {
        breakStream();
        writeInline(`  ${BAR} ${callPrefix(_call)}${ts()} 🎙️  ${chalk.white.bold(e.text)}\n`);
        write("\n");
    });

    // ── Turn events ──
    agent.on("eager.turn", (turn: Turn, call: Call) => {
        breakStream();
        if (onTurn) onTurn(turn, call);
    });

    agent.on("turn.pause" as any, (e: any, _call: Call) => {
        const prob = e.probability ?? 0;
        writeInline(`  ${BAR} ${ts()} ${WARN("pause")} ${DIM(`p=${prob.toFixed(2)}`)}`);
    });

    agent.on("turn.end", (_turn: Turn, _call: Call) => {
        breakStream();
        const prob = _turn.probability ?? 0;
        logLine(`${callPrefix(_call)}${ts()} ${OK("⏹ turn.end")} ${DIM(`p=${prob.toFixed(2)}`)} ${dur(_turn.latencyMs)}`);
    });

    agent.on("turn.continued", (_e: any, _call: Call) => {
        breakStream();
        logLine(`${callPrefix(_call)}${ts()} ${WARN("⚠ turn.continued")} ${DIM("user kept speaking")}`);
    });

    agent.on("turn.resumed", () => {
        breakStream();
        logLine(`${ts()} ${DIM("turn.resumed")}`);
    });

    // ── Bot events ──
    let botMsgId = "";

    agent.on("bot.word", (e: any, _call: Call) => {
        breakStream();
        if (e.message_id !== botMsgId) {
            botMsgId = e.message_id;
            write(`  ${BAR} ${ts()} 🔊 ${BRAND(e.word)}`);
        } else {
            write(` ${BRAND(e.word)}`);
        }
    });

    agent.on("bot.finished", (e: any, _call: Call) => {
        if (botMsgId) {
            write("\n");
            botMsgId = "";
        }
        logLine(`${DIM("     bot.finished")} ${dur(e.duration_ms)}`);
    });

    agent.on("bot.interrupted", (e: any, _call: Call) => {
        if (botMsgId) {
            write(` ${WARN("[interrupted]")}\n`);
            botMsgId = "";
        }
        logLine(`${DIM("     ")}${WARN("⚠ interrupted")} ${DIM(`after ${e.words_spoken} words`)}`);
    });

    // ── Reply events ──
    agent.on("message.confirmed", (e: any, _call: Call) => {
        logLine(`${DIM("     ")}${OK("✓ confirmed")} ${DIM(e.message_id.slice(0, 12))}`);
        write("\n"); // breathing room between turns
    });

    agent.on("reply.rejected", (e: any, _call: Call) => {
        logLine(`${DIM("     ")}${ERR("✗ rejected")} ${DIM(e.reason)} ${DIM(e.message_id.slice(0, 12))}`);
        write("\n");
    });

    // ── Hold/Mute ──
    agent.on("call.held" as any, () => {
        logLine(`${ts()} ${MUTED("call held")}`);
    });

    agent.on("call.unheld" as any, () => {
        logLine(`${ts()} ${MUTED("call unheld")}`);
    });
}

// ── Attach LLM events (for `pinecall run` with GPTAgent) ─────────────────

export function attachLLMEvents(agent: Agent): void {
    let replyBuf = "";

    agent.on("llm.start" as any, (_call: Call, data: any) => {
        const round = data?.round ?? 0;
        const model = data?.model ?? "gpt";

        _llmStreaming = true;
        _llmStreamStarted = false;

        llmHeader(`GPT ${model}`);
        if (round > 0) {
            llmLine(`${DIM(`tool round ${round + 1}`)}`);
        }
        replyBuf = "";
    });

    agent.on("llm.token" as any, (_call: Call, data: any) => {
        const token = data?.token ?? "";
        replyBuf += token;
        ensureStreamPrefix();
        write(token);
    });

    agent.on("llm.done" as any, (_call: Call, data: any) => {
        const aborted = data?.aborted ?? false;
        breakStream();
        if (replyBuf && !aborted) {
            const tokens = replyBuf.split(/\s+/).length;
            llmLine(`${OK("✓")} ${DIM(`~${tokens} tokens`)}`);
        } else if (aborted) {
            llmLine(`${WARN("[aborted]")}`);
        }
        llmHeader("");
        replyBuf = "";
        _llmStreaming = false;
        _llmStreamStarted = false;
    });

    agent.on("llm.tool_call" as any, (_call: Call, data: any) => {
        breakStream();
        const name = data?.name ?? "?";
        const args = data?.args ?? "{}";
        let argsFmt: string;
        try { argsFmt = JSON.stringify(JSON.parse(args)); } catch { argsFmt = args; }
        llmLine(`${WARN("🔧")} ${chalk.hex("#9d4edd").bold(name)}${DIM(`(${argsFmt})`)}`);
    });

    agent.on("llm.tool_result" as any, (_call: Call, data: any) => {
        let resultStr: string;
        try { resultStr = JSON.stringify(data?.result); } catch { resultStr = String(data?.result); }
        const truncated = resultStr.length > 120 ? resultStr.slice(0, 120) + "…" : resultStr;
        llmLine(`  ${OK("→")} ${DIM(truncated)}`);
    });

    // Suppress agent.log debug noise (🆕 eager.turn, etc.)
    // These are internal diagnostics, not useful for the operator.
}

// ── LLM streaming for agent/dial commands ─────────────────────────────────

export interface LLMContext {
    openai: OpenAI;
    model: string;
    history: { role: string; content: string }[];
    errorMsg: string;
}

export async function streamLLMReply(
    call: Call,
    turn: Turn,
    ctx: LLMContext,
): Promise<string | null> {
    ctx.history.push({ role: "user", content: turn.text });

    _llmStreaming = true;
    _llmStreamStarted = false;

    llmHeader(`GPT ${ctx.model}`);

    const stream = call.replyStream(turn);

    try {
        const completion = await ctx.openai.chat.completions.create({
            model: ctx.model,
            messages: ctx.history as OpenAI.ChatCompletionMessageParam[],
            stream: true,
        });

        let reply = "";
        let tokenCount = 0;

        for await (const chunk of completion) {
            if (stream.aborted) break;
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
                stream.write(token);
                reply += token;
                tokenCount++;
                ensureStreamPrefix();
                write(token);
            }
        }

        breakStream();
        stream.end();

        if (reply && !stream.aborted) {
            llmLine(`${OK("✓")} ${DIM(`${tokenCount} tokens`)}`);
            ctx.history.push({ role: "assistant", content: reply });
        } else if (stream.aborted) {
            llmLine(`${WARN("[aborted]")}`);
        }

        llmHeader("");
        _llmStreaming = false;
        _llmStreamStarted = false;
        return stream.aborted ? null : reply;
    } catch {
        breakStream();
        stream.end();
        llmLine(`${ERR("✗ LLM error")}`);
        llmHeader("");
        _llmStreaming = false;
        _llmStreamStarted = false;
        call.reply(ctx.errorMsg);
        return null;
    }
}
