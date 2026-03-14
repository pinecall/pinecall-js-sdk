/**
 * Slash command dispatch — handles user commands during an active call session.
 *
 * Each command is a named handler in a registry, not inline in a switch.
 * Supports an optional `log` callback and `selectedCall` for TUI integration.
 */

import type { Agent, Call } from "@pinecall/sdk";
import { MUTED, OK, WARN, ERR, DIM } from "./theme.js";
import { logLine } from "./renderer.js";
import { getActiveCalls, getSelectedCall, selectCall, getCallLabel } from "./events.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface CommandContext {
    agent: Agent;
    instructions: string;
    log?: (msg: string) => void;
    /** Returns raw LLM history for a call (JSON-serializable messages array). */
    getHistory?: (callId: string) => unknown[] | undefined;
}

interface CommandDef {
    description: string;
    usage?: string;
    handler: (ctx: CommandContext, args: string[]) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Get selected call or the only active call. */
function resolveCall(ctx: CommandContext): Call | null {
    const selected = getSelectedCall();
    if (selected) return selected;
    const calls = ctx.agent.calls;
    if (calls.size === 1) return [...calls.values()][0];
    return null;
}

// ── Command handlers ─────────────────────────────────────────────────────

function handleHelp(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    log(`${DIM("Commands:")}`);
    for (const [name, def] of Object.entries(commands)) {
        const usage = def.usage ? ` ${DIM(def.usage)}` : "";
        log(`  ${MUTED(name.padEnd(12))}${usage} ${DIM(def.description)}`);
    }
}

function handleHangup(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (call) {
        call.hangup();
        log(`${OK("✓")} Hanging up ${DIM(call.id.slice(0, 12))}`);
        return;
    }
    const calls = ctx.agent.calls;
    if (calls.size === 0) {
        log(`${WARN("No active calls")}`);
        return;
    }
    for (const c of calls.values()) {
        c.hangup();
        log(`${OK("✓")} Hanging up ${DIM(c.id.slice(0, 12))}`);
    }
}

function handleHold(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (call) { call.hold(); log(`${OK("✓")} Call on hold`); }
    else log(`${WARN("No active calls")}`);
}

function handleUnhold(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (call) { call.unhold(); log(`${OK("✓")} Call resumed`); }
    else log(`${WARN("No active calls")}`);
}

function handleMute(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (call) { call.mute(); log(`${OK("✓")} Mic muted`); }
    else log(`${WARN("No active calls")}`);
}

function handleUnmute(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (call) { call.unmute(); log(`${OK("✓")} Mic unmuted`); }
    else log(`${WARN("No active calls")}`);
}

function handleCalls(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const active = getActiveCalls();
    if (active.size === 0) {
        log(`${DIM("No active calls")}`);
        return;
    }
    const selected = getSelectedCall();
    for (const entry of active.values()) {
        const c = entry.call;
        const sel = c.id === selected?.id ? OK("▸") : " ";
        const dir = c.direction === "inbound" ? "←" : "→";
        const elapsed = ((Date.now() - entry.startTime) / 1000).toFixed(0) + "s";
        log(`${sel} ${DIM(`[${entry.index}]`)} ${dir} ${c.from} → ${c.to} ${MUTED(elapsed)} ${DIM(c.id.slice(0, 12))}`);
    }
}

function handleSwitch(ctx: CommandContext, args: string[]): void {
    const log = ctx.log ?? logLine;
    const target = args[0];
    if (!target) {
        log(`${WARN("Usage:")} /switch <number|call-id-prefix>`);
        return;
    }
    const call = selectCall(target);
    if (call) {
        log(`${OK("✓")} Selected call ${getCallLabel(call)} ${DIM(call.id.slice(0, 12))}`);
    } else {
        log(`${ERR("Not found:")} no call matching "${target}"`);
    }
}

function handleConfig(ctx: CommandContext, args: string[]): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (!call) {
        log(`${WARN("No active call")} — start a call first`);
        return;
    }

    const [sub, ...rest] = args;
    const value = rest.join(" ");

    if (!sub) {
        log(`${DIM("Usage:")} /config voice|stt|turn|lang <value>`);
        log(`  ${MUTED("/config voice")} elevenlabs:abc123`);
        log(`  ${MUTED("/config stt")}   deepgram:nova-3:es`);
        log(`  ${MUTED("/config turn")}  smart_turn [silenceMs]`);
        log(`  ${MUTED("/config lang")}  fr`);
        return;
    }

    switch (sub) {
        case "voice":
        case "tts":
            if (!value) { log(`${WARN("Usage:")} /config voice <voice-id>`); return; }
            call.configure({ voice: value });
            log(`${OK("✓")} Voice → ${value}`);
            break;

        case "stt":
            if (!value) { log(`${WARN("Usage:")} /config stt <provider:model>`); return; }
            call.configure({ stt: value });
            log(`${OK("✓")} STT → ${value}`);
            break;

        case "turn":
            if (!value) { log(`${WARN("Usage:")} /config turn <mode> [silenceMs]`); return; }
            const [mode, silenceStr] = value.split(" ");
            const turnConfig = silenceStr
                ? { mode, silenceMs: parseInt(silenceStr, 10) }
                : mode;
            call.configure({ turnDetection: turnConfig });
            log(`${OK("✓")} Turn detection → ${value}`);
            break;

        case "lang":
        case "language":
            if (!value) { log(`${WARN("Usage:")} /config lang <code>`); return; }
            call.configure({ language: value });
            log(`${OK("✓")} Language → ${value}`);
            break;

        default:
            log(`${ERR("Unknown config:")} ${sub}. Options: voice, stt, turn, lang`);
    }
}

// ── Command registry ─────────────────────────────────────────────────────

const commands: Record<string, CommandDef> = {
    "/help":    { description: "Show available commands", handler: handleHelp },
    "/calls":   { description: "List active calls", handler: handleCalls },
    "/switch":  { description: "Select active call", usage: "<1|sid>", handler: handleSwitch },
    "/config":  { description: "Change call config", usage: "<voice|stt|turn|lang> <val>", handler: handleConfig },
    "/hangup":  { description: "Hang up selected call (or all)", handler: handleHangup },
    "/hold":    { description: "Put selected call on hold", handler: handleHold },
    "/unhold":  { description: "Resume held call", handler: handleUnhold },
    "/mute":    { description: "Mute the microphone", handler: handleMute },
    "/unmute":  { description: "Unmute the microphone", handler: handleUnmute },
    "/history": { description: "Show raw LLM history (JSON)", handler: handleHistory },
};

/**
 * Dispatch a slash command.
 * Returns true if the command was handled, false if unknown.
 */
export function handleCommand(input: string, ctx: CommandContext): boolean {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    const log = ctx.log ?? logLine;
    const def = commands[cmd];
    if (!def) {
        if (cmd.startsWith("/")) {
            log(`${ERR("Unknown command:")} ${cmd}. Type /help for available commands.`);
            return true;
        }
        return false;
    }
    def.handler(ctx, args);
    return true;
}

// ── /history command ─────────────────────────────────────────────────────

import chalk from "chalk";

/** Syntax-highlight a JSON string with chalk colors. */
function highlightJson(json: string): string {
    return json
        // Keys
        .replace(/"(\w+)"\s*:/g, (_, key) => `${chalk.hex("#9d4edd")(`"${key}"`)}:`)
        // String values (after colon)
        .replace(/:\s*"([^"]*)"/g, (_, val) => `: ${chalk.hex("#22C55E")(`"${val}"`)}`)  
        // Numbers
        .replace(/:\s*(\d+\.?\d*)/g, (_, num) => `: ${chalk.hex("#F59E0B")(num)}`)
        // Booleans / null
        .replace(/:\s*(true|false|null)/g, (_, val) => `: ${chalk.hex("#06B6D4")(val)}`);
}

function handleHistory(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;

    // Find a call to get history for
    const call = resolveCall(ctx) ?? [...ctx.agent.calls.values()][0];
    if (!call && !ctx.getHistory) {
        log(`${DIM("No active calls and no history available")}`);
        return;
    }

    const callId = call?.id;
    let messages: unknown[] | undefined;

    if (ctx.getHistory && callId) {
        messages = ctx.getHistory(callId);
    }

    if (!messages || messages.length === 0) {
        log(`${DIM("No history for ${callId ? callId.slice(0, 12) : 'any call'}")}`);
        return;
    }

    log(`${MUTED(`─── History (${messages.length} messages) ───`)}`);

    for (const msg of messages) {
        const raw = JSON.stringify(msg, null, 2);
        const highlighted = highlightJson(raw);
        for (const line of highlighted.split("\n")) {
            log(`  ${line}`);
        }
        log(""); // spacing between messages
    }

    log(`${MUTED(`─── End (${messages.length} messages) ───`)}`);
}
