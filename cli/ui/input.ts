/**
 * Input — readline-based command prompt for slash commands.
 *
 * Uses Node's built-in readline for:
 *  - Visible prompt with cursor
 *  - Arrow key history navigation
 *  - Tab completion for /commands
 *  - Ctrl+C to exit
 *
 * Exports clearPrompt / redrawPrompt so the renderer can
 * temporarily hide the prompt while writing event output.
 */

import * as readline from "node:readline";
import type { Agent } from "@pinecall/sdk";
import { Pinecall } from "@pinecall/sdk";
import chalk from "chalk";
import { handleCommand } from "./commands.js";
import { logLine, write } from "./renderer.js";
import { MUTED, DIM } from "./theme.js";

// ── Available commands for tab completion ────────────────────────────────

const COMMAND_LIST = [
    "/help", "/hangup", "/hold", "/unhold",
    "/mute", "/unmute", "/calls", "/history",
];

// ── Prompt appearance ────────────────────────────────────────────────────

const PROMPT = chalk.hex("#c084fc")("  ◇ ");

// ── Module-level rl reference for prompt management ──────────────────────

let _rl: readline.Interface | null = null;

/**
 * Clear the current readline prompt from the terminal.
 * Call this before writing any output to prevent interleaving.
 */
export function clearPrompt(): void {
    if (!_rl) return;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
}

/**
 * Re-display the readline prompt after output.
 */
export function redrawPrompt(): void {
    if (!_rl) return;
    _rl.prompt(true);
}

// ── Start ────────────────────────────────────────────────────────────────

export interface InputOptions {
    agent: Agent;
    pc: Pinecall;
    /** Optional: returns raw LLM history for a call. */
    getHistory?: (callId: string) => unknown[] | undefined;
}

export function startInput(opts: InputOptions): void {
    const { agent, pc } = opts;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: PROMPT,
        terminal: true,
        completer: (line: string) => {
            const hits = COMMAND_LIST.filter((c) => c.startsWith(line));
            return [hits.length ? hits : COMMAND_LIST, line];
        },
    });

    _rl = rl;

    // Show initial hint and prompt
    write("\n");
    logLine(`${DIM("Type /help for commands · Ctrl+C to exit")}`);
    write("\n");
    rl.prompt();

    // ── Handle line input ──
    rl.on("line", (input: string) => {
        const trimmed = input.trim();
        if (!trimmed) {
            rl.prompt();
            return;
        }

        // Dispatch slash command
        if (trimmed.startsWith("/")) {
            handleCommand(trimmed, {
                agent,
                instructions: "",
                log: logLine,
                getHistory: opts.getHistory,
            });
        }

        rl.prompt();
    });

    // ── Ctrl+C to exit ──
    rl.on("SIGINT", async () => {
        write("\n");
        logLine(`${MUTED("Disconnecting…")}`);
        try {
            await pc.disconnect();
        } catch { /* ignore */ }
        process.exit(0);
    });

    // ── Handle close ──
    rl.on("close", () => {
        process.exit(0);
    });
}
