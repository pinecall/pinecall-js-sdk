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
    "/help", "/phones", "/voices", "/play",
    "/calls", "/switch", "/config", "/dial",
    "/hangup", "/hold", "/unhold",
    "/mute", "/unmute", "/history",
];

// ── Prompt appearance ────────────────────────────────────────────────────

const PROMPT = chalk.hex("#c084fc")("  ◇ ");

// ── Module-level rl reference for prompt management ──────────────────────

let _rl: readline.Interface | null = null;

/** Active audio playback child process (for Ctrl+C cancellation). */
let _playingProcess: import("node:child_process").ChildProcess | null = null;
let _playingCleanup: (() => void) | null = null;

/** Set the currently playing audio process (called by /play command). */
export function setPlayingProcess(proc: any, cleanup?: () => void): void {
    _playingProcess = proc;
    _playingCleanup = cleanup ?? null;
}

/** Clear the playing audio process reference. */
export function clearPlayingProcess(): void {
    _playingProcess = null;
    _playingCleanup = null;
}

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
    /** All loaded agents for multi-agent commands. */
    agents?: Map<string, Agent>;
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
                pc,
                agents: opts.agents,
                instructions: "",
                log: logLine,
                getHistory: opts.getHistory,
            });
        }

        rl.prompt();
    });

    // ── Ctrl+C to exit ──
    rl.on("SIGINT", async () => {
        // If audio is playing, kill it instead of exiting
        if (_playingProcess) {
            _playingProcess.kill();
            if (_playingCleanup) _playingCleanup();
            _playingProcess = null;
            _playingCleanup = null;
            return;
        }
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
