/**
 * Slash command dispatch — handles user commands during an active call session.
 *
 * Uses execFileSync instead of execSync for /instructions (security fix).
 * Each command is a named handler in a registry, not inline in a switch.
 */

import { execFileSync } from "child_process";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { Agent, Call } from "@pinecall/sdk";
import { MUTED, OK, WARN, ERR, DIM } from "./theme.js";
import { logLine } from "./renderer.js";

// ── Types ────────────────────────────────────────────────────────────────

interface CommandContext {
    agent: Agent;
    instructions: string;
    onInstructionsChange?: (newInstructions: string) => void;
}

interface CommandDef {
    description: string;
    handler: (ctx: CommandContext) => void;
}

// ── Command handlers ─────────────────────────────────────────────────────

function handleHelp(_ctx: CommandContext): void {
    logLine(`${DIM("Commands:")}`);
    for (const [name, def] of Object.entries(commands)) {
        logLine(`  ${MUTED(name.padEnd(16))} ${DIM(def.description)}`);
    }
}

function handleInstructions(ctx: CommandContext): void {
    const editor = process.env.EDITOR || "vi";
    const tmpFile = join(tmpdir(), `pinecall-instructions-${Date.now()}.md`);

    try {
        writeFileSync(tmpFile, ctx.instructions, "utf-8");
        // Use execFileSync instead of execSync to prevent shell injection
        execFileSync(editor, [tmpFile], { stdio: "inherit" });
        const updated = readFileSync(tmpFile, "utf-8");
        unlinkSync(tmpFile);

        if (updated !== ctx.instructions && ctx.onInstructionsChange) {
            ctx.onInstructionsChange(updated);
            logLine(`${OK("✓")} Instructions updated (${updated.length} chars)`);
        } else {
            logLine(`${DIM("Instructions unchanged")}`);
        }
    } catch {
        logLine(`${ERR("Failed to open editor")} ${DIM(`($EDITOR = ${editor})`)}`);
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}

function handleHangup(ctx: CommandContext): void {
    const calls = ctx.agent.calls;
    if (calls.size === 0) {
        logLine(`${WARN("No active calls")}`);
        return;
    }
    for (const call of calls.values()) {
        call.hangup();
        logLine(`${OK("✓")} Hanging up ${DIM(call.id.slice(0, 12))}`);
    }
}

function handleHold(ctx: CommandContext): void {
    for (const call of ctx.agent.calls.values()) {
        call.hold();
        logLine(`${OK("✓")} Call on hold`);
    }
}

function handleUnhold(ctx: CommandContext): void {
    for (const call of ctx.agent.calls.values()) {
        call.unhold();
        logLine(`${OK("✓")} Call resumed`);
    }
}

function handleMute(ctx: CommandContext): void {
    for (const call of ctx.agent.calls.values()) {
        call.mute();
        logLine(`${OK("✓")} Mic muted`);
    }
}

function handleUnmute(ctx: CommandContext): void {
    for (const call of ctx.agent.calls.values()) {
        call.unmute();
        logLine(`${OK("✓")} Mic unmuted`);
    }
}

function handleCalls(ctx: CommandContext): void {
    const calls = ctx.agent.calls;
    if (calls.size === 0) {
        logLine(`${DIM("No active calls")}`);
        return;
    }
    for (const call of calls.values()) {
        logLine(`${call.direction === "inbound" ? "←" : "→"} ${call.from} → ${call.to} ${DIM(call.id.slice(0, 12))}`);
    }
}

// ── Command registry ─────────────────────────────────────────────────────

const commands: Record<string, CommandDef> = {
    "/help": { description: "Show available commands", handler: handleHelp },
    "/instructions": { description: "Edit system prompt in $EDITOR", handler: handleInstructions },
    "/hangup": { description: "Hang up all active calls", handler: handleHangup },
    "/hold": { description: "Put active calls on hold", handler: handleHold },
    "/unhold": { description: "Resume held calls", handler: handleUnhold },
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
    const def = commands[cmd];
    if (!def) {
        if (cmd.startsWith("/")) {
            logLine(`${ERR("Unknown command:")} ${cmd}. Type /help for available commands.`);
            return true;
        }
        return false;
    }
    def.handler(ctx);
    return true;
}
