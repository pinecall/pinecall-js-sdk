/**
 * Slash command dispatch — handles user commands during an active call session.
 *
 * Each command is a named handler in a registry, not inline in a switch.
 * Supports an optional `log` callback and `selectedCall` for TUI integration.
 */

import type { Agent, Call } from "@pinecall/sdk";
import { MUTED, OK, WARN, ERR, DIM } from "./theme.js";
import { logLine } from "./renderer.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface CommandContext {
    agent: Agent;
    instructions: string;
    log?: (msg: string) => void;
    selectedCall?: Call;
}

interface CommandDef {
    description: string;
    handler: (ctx: CommandContext) => void;
}

// ── Command handlers ─────────────────────────────────────────────────────

function handleHelp(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    log(`${DIM("Commands:")}`);
    for (const [name, def] of Object.entries(commands)) {
        log(`  ${MUTED(name.padEnd(16))} ${DIM(def.description)}`);
    }
}



function handleHangup(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    if (ctx.selectedCall) {
        ctx.selectedCall.hangup();
        log(`${OK("✓")} Hanging up ${DIM(ctx.selectedCall.id.slice(0, 12))}`);
        return;
    }
    const calls = ctx.agent.calls;
    if (calls.size === 0) {
        log(`${WARN("No active calls")}`);
        return;
    }
    for (const call of calls.values()) {
        call.hangup();
        log(`${OK("✓")} Hanging up ${DIM(call.id.slice(0, 12))}`);
    }
}

function handleHold(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const target = ctx.selectedCall ? [ctx.selectedCall] : [...ctx.agent.calls.values()];
    for (const call of target) {
        call.hold();
        log(`${OK("✓")} Call on hold`);
    }
}

function handleUnhold(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const target = ctx.selectedCall ? [ctx.selectedCall] : [...ctx.agent.calls.values()];
    for (const call of target) {
        call.unhold();
        log(`${OK("✓")} Call resumed`);
    }
}

function handleMute(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const target = ctx.selectedCall ? [ctx.selectedCall] : [...ctx.agent.calls.values()];
    for (const call of target) {
        call.mute();
        log(`${OK("✓")} Mic muted`);
    }
}

function handleUnmute(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const target = ctx.selectedCall ? [ctx.selectedCall] : [...ctx.agent.calls.values()];
    for (const call of target) {
        call.unmute();
        log(`${OK("✓")} Mic unmuted`);
    }
}

function handleCalls(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const calls = ctx.agent.calls;
    if (calls.size === 0) {
        log(`${DIM("No active calls")}`);
        return;
    }
    for (const call of calls.values()) {
        log(`${call.direction === "inbound" ? "←" : "→"} ${call.from} → ${call.to} ${DIM(call.id.slice(0, 12))}`);
    }
}

// ── Command registry ─────────────────────────────────────────────────────

const commands: Record<string, CommandDef> = {
    "/help": { description: "Show available commands", handler: handleHelp },
    "/hangup": { description: "Hang up selected call (or all)", handler: handleHangup },
    "/hold": { description: "Put selected call on hold", handler: handleHold },
    "/unhold": { description: "Resume held call", handler: handleUnhold },
    "/mute": { description: "Mute the microphone", handler: handleMute },
    "/unmute": { description: "Unmute the microphone", handler: handleUnmute },
    "/calls": { description: "List active calls", handler: handleCalls },
};

/**
 * Dispatch a slash command.
 * Returns true if the command was handled, false if unknown.
 */
export function handleCommand(input: string, ctx: CommandContext): boolean {
    const cmd = input.trim().split(/\s+/)[0].toLowerCase();
    const log = ctx.log ?? logLine;
    const def = commands[cmd];
    if (!def) {
        if (cmd.startsWith("/")) {
            log(`${ERR("Unknown command:")} ${cmd}. Type /help for available commands.`);
            return true;
        }
        return false;
    }
    def.handler(ctx);
    return true;
}
