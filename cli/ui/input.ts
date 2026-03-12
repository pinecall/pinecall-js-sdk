/**
 * Readline lifecycle — prompt, SIGINT handling, and input processing.
 *
 * Key improvement: SIGINT handler is registered exactly once.
 */

import { createInterface, type Interface } from "readline";
import type { Agent } from "@pinecall/sdk";
import { Pinecall } from "@pinecall/sdk";
import { BRAND, MUTED, DIM } from "./theme.js";
import { write, writeln, ensureCursor } from "./renderer.js";
import { handleCommand } from "./commands.js";

export interface InputOptions {
    agent: Agent;
    pc: Pinecall;
    instructions: string;
    onInstructionsChange: (newInstructions: string) => void;
}

/**
 * Start the interactive input loop.
 * Handles slash commands and SIGINT for graceful shutdown.
 */
export function startInput(opts: InputOptions): void {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `  ${MUTED("›")} `,
    });

    const ctx = {
        agent: opts.agent,
        instructions: opts.instructions,
        onInstructionsChange: (newInstructions: string) => {
            ctx.instructions = newInstructions;
            opts.onInstructionsChange(newInstructions);
        },
    };

    rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            rl.prompt();
            return;
        }
        handleCommand(trimmed, ctx);
        rl.prompt();
    });

    // Single SIGINT handler — graceful shutdown
    rl.on("close", async () => {
        writeln("");
        writeln(`  ${DIM("Shutting down…")}`);
        ensureCursor();
        await opts.pc.disconnect();
        process.exit(0);
    });

    rl.prompt();
}
