/**
 * TUI input — blessed textbox replacing readline.
 *
 * Dispatches slash commands to handleCommand() with log routed
 * to the selected call's pane via sidebar.logCall().
 */

import type { Agent } from "@pinecall/sdk";
import { Pinecall } from "@pinecall/sdk";
import type { TUI } from "./tui.js";
import type { CallSidebar } from "./tui-sidebar.js";
import { handleCommand } from "./commands.js";

// ── Options ──────────────────────────────────────────────────────────────

export interface TUIInputOptions {
    tui: TUI;
    sidebar: CallSidebar;
    agent: Agent;
    pc: Pinecall;
}

// ── Start ────────────────────────────────────────────────────────────────

export function startTUIInput(opts: TUIInputOptions): void {
    const { tui, sidebar, agent, pc } = opts;

    // ── Intercept ↑↓ keys before textbox processes them ──
    // The textbox grabs all keys when focused, so we must
    // listen on the input element itself, not on screen.
    tui.input.on("keypress", (_ch: string, key: any) => {
        if (key?.name === "up") {
            sidebar.moveUp();
            return;
        }
        if (key?.name === "down") {
            sidebar.moveDown();
            return;
        }
    });

    tui.input.on("submit", (value: string) => {
        const trimmed = value?.trim();
        if (!trimmed) {
            tui.input.clearValue();
            tui.input.focus();
            tui.screen.render();
            return;
        }

        // Build command context — route output to selected call pane
        const selectedId = sidebar.selectedCallId();
        const log = selectedId
            ? (msg: string) => sidebar.logCall(selectedId, msg)
            : (msg: string) => tui.callLog.log(msg);

        // Find the selected Call object for targeted commands
        const selectedCall = selectedId ? agent.calls.get(selectedId) : undefined;

        handleCommand(trimmed, {
            agent,
            instructions: "",
            log,
            selectedCall,
        });

        tui.input.clearValue();
        tui.input.focus();
        tui.screen.render();
    });

    // ── Ctrl-C → graceful shutdown ──
    tui.screen.key(["C-c"], async () => {
        tui.destroy();
        await pc.disconnect();
        process.exit(0);
    });

    // Focus the input by default
    tui.input.focus();
    tui.screen.render();
}
