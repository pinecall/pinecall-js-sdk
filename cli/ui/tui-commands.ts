/**
 * TUI Command Palette — Ctrl+O modal with all available actions.
 *
 * Opens a centered list of commands. Some commands execute immediately,
 * others prompt for a parameter (DTMF digits, forward number, say text).
 *
 * ┌──────── Commands ────────┐
 * │  ▸ Hangup                │
 * │    Hold                  │
 * │    Unhold                │
 * │    Mute                  │
 * │    Unmute                │
 * │    DTMF…                 │
 * │    Forward…              │
 * │    Say…                  │
 * │    Clear queue           │
 * │    Cancel message        │
 * └──────────────────────────┘
 */

import blessed from "blessed";
import { execSync } from "child_process";
import type { Agent, Call } from "@pinecall/sdk";
import { Pinecall } from "@pinecall/sdk";
import type { TUI } from "./tui.js";
import type { CallSidebar } from "./tui-sidebar.js";
import { handleCommand } from "./commands.js";

// ── Command definition ───────────────────────────────────────────────────

interface PaletteCommand {
    label: string;
    key?: string;           // shortcut key shown in palette
    needsParam?: string;    // placeholder for input prompt
    action: (call: Call, param?: string) => void;
}

// ── Build command list ───────────────────────────────────────────────────

function buildCommands(): PaletteCommand[] {
    return [
        {
            label: "Hangup",
            key: "h",
            action: (call) => call.hangup(),
        },
        {
            label: "Hold",
            action: (call) => call.hold(),
        },
        {
            label: "Unhold",
            action: (call) => call.unhold(),
        },
        {
            label: "Mute",
            action: (call) => call.mute(),
        },
        {
            label: "Unmute",
            action: (call) => call.unmute(),
        },
        {
            label: "DTMF…",
            key: "d",
            needsParam: "Digits (e.g. 1234#)",
            action: (call, digits) => {
                if (digits) call.sendDTMF(digits);
            },
        },
        {
            label: "Forward…",
            key: "f",
            needsParam: "Forward to number",
            action: (call, to) => {
                if (to) call.forward(to);
            },
        },
        {
            label: "Say…",
            key: "s",
            needsParam: "Message text",
            action: (call, text) => {
                if (text) call.say(text);
            },
        },
        {
            label: "Clear queue",
            action: (call) => call.clear(),
        },
        {
            label: "Cancel message",
            action: (call) => call.cancel(),
        },
    ];
}

// ── Setup ────────────────────────────────────────────────────────────────

export interface CommandPaletteOptions {
    tui: TUI;
    sidebar: CallSidebar;
    agent: Agent;
    pc: Pinecall;
}

export function setupCommandPalette(opts: CommandPaletteOptions): void {
    const { tui, sidebar, agent, pc } = opts;
    const commands = buildCommands();

    let modal: blessed.Widgets.ListElement | null = null;
    let paramBox: blessed.Widgets.TextboxElement | null = null;
    let textInput: blessed.Widgets.TextboxElement | null = null;
    let isOpen = false;

    function getSelectedCall(): Call | undefined {
        const id = sidebar.selectedCallId();
        return id ? agent.calls.get(id) : undefined;
    }

    function logToCall(msg: string): void {
        const id = sidebar.selectedCallId();
        if (id) {
            sidebar.logCall(id, msg);
        } else {
            tui.callLog.log(msg);
        }
    }

    // ── Open palette ──
    function openPalette(): void {
        if (isOpen) return;
        isOpen = true;

        const items = commands.map((c, i) => {
            const key = c.key ? `{gray-fg}[${c.key}]{/gray-fg} ` : "    ";
            return `${key}${c.label}`;
        });

        modal = blessed.list({
            parent: tui.screen,
            label: " {bold}Commands{/bold} ",
            top: "center",
            left: "center",
            width: 32,
            height: items.length + 2,
            border: { type: "line" },
            tags: true,
            keys: true,
            vi: false,
            mouse: true,
            items,
            style: {
                border: { fg: "cyan" },
                // label color set via tags in the label prop
                selected: { fg: "black", bg: "cyan", bold: true },
                item: { fg: "white" },
                bg: "#0a0a0a",
            },
        });

        modal.focus();
        tui.screen.render();

        // ── Select command ──
        modal.on("select", (_item: any, index: number) => {
            const cmd = commands[index];
            if (!cmd) { closePalette(); return; }

            const call = getSelectedCall();
            if (!call) {
                closePalette();
                logToCall("{yellow-fg}No call selected{/yellow-fg}");
                return;
            }

            if (cmd.needsParam) {
                // Show param input
                showParamInput(cmd, call);
            } else {
                closePalette();
                cmd.action(call);
                logToCall(`{green-fg}✓{/green-fg} ${cmd.label}`);
            }
        });

        // ── Cancel ──
        modal.key(["escape", "C-o"], () => {
            closePalette();
        });

        // ── Shortcut keys ──
        modal.key(commands.filter(c => c.key).map(c => c.key!), (_ch: any, key: any) => {
            const cmd = commands.find(c => c.key === key.name);
            if (!cmd) return;

            const call = getSelectedCall();
            if (!call) {
                closePalette();
                logToCall("{yellow-fg}No call selected{/yellow-fg}");
                return;
            }

            if (cmd.needsParam) {
                showParamInput(cmd, call);
            } else {
                closePalette();
                cmd.action(call);
                logToCall(`{green-fg}✓{/green-fg} ${cmd.label}`);
            }
        });
    }

    // ── Param input ──
    function showParamInput(cmd: PaletteCommand, call: Call): void {
        // Remove the list but keep modal state
        if (modal) {
            modal.detach();
            modal = null;
        }

        paramBox = blessed.textbox({
            parent: tui.screen,
            label: ` ${cmd.label} `,
            top: "center",
            left: "center",
            width: 44,
            height: 3,
            border: { type: "line" },
            inputOnFocus: true,
            tags: true,
            style: {
                border: { fg: "cyan" },
                label: { fg: "cyan", bold: true },
                bg: "#0a0a0a",
            },
        });

        paramBox.focus();
        tui.screen.render();

        paramBox.on("submit", (value: string) => {
            const trimmed = value?.trim();
            closeParamBox();
            closePalette();

            if (trimmed) {
                cmd.action(call, trimmed);
                logToCall(`{green-fg}✓{/green-fg} ${cmd.label} {gray-fg}${trimmed}{/gray-fg}`);
            }
        });

        paramBox.key(["escape"], () => {
            closeParamBox();
            closePalette();
        });
    }

    function closeParamBox(): void {
        if (paramBox) {
            paramBox.detach();
            paramBox = null;
        }
    }

    // ── Close palette ──
    function closePalette(): void {
        closeParamBox();
        if (modal) {
            modal.detach();
            modal = null;
        }
        isOpen = false;
        tui.screen.render();
    }

    // ── Key bindings ──

    // Ctrl+O → open command palette
    tui.screen.key(["C-o"], () => {
        if (isOpen) {
            closePalette();
        } else {
            openPalette();
        }
    });

    // Ctrl+T → open text command input
    tui.screen.key(["C-t"], () => {
        if (isOpen) return;
        openTextInput();
    });

    // ↑↓ for sidebar navigation (when palette is not open)
    tui.screen.key(["up"], () => {
        if (!isOpen) sidebar.moveUp();
    });
    tui.screen.key(["down"], () => {
        if (!isOpen) sidebar.moveDown();
    });

    // Ctrl+C → graceful shutdown
    tui.screen.key(["C-c"], async () => {
        tui.destroy();
        await pc.disconnect();
        process.exit(0);
    });

    // Ctrl+Y → copy LLM pane to clipboard
    tui.screen.key(["C-y"], () => {
        const lines = sidebar.getLLMLines();
        if (lines.length === 0) {
            logToCall("{yellow-fg}No LLM content to copy{/yellow-fg}");
            return;
        }
        // Strip blessed tags for clean clipboard text
        const clean = lines.map(l => l.replace(/\{[^}]+\}/g, "")).join("\n");
        try {
            execSync("pbcopy", { input: clean });
            logToCall("{green-fg}✓{/green-fg} {gray-fg}LLM log copied to clipboard{/gray-fg}");
        } catch {
            logToCall("{red-fg}✗ Failed to copy to clipboard{/red-fg}");
        }
    });

    // ── Text command input (Ctrl+T) ──
    function openTextInput(): void {
        if (isOpen) return;
        isOpen = true;

        textInput = blessed.textbox({
            parent: tui.screen,
            label: " {cyan-fg}Command{/cyan-fg} ",
            top: "center",
            left: "center",
            width: 50,
            height: 3,
            border: { type: "line" },
            inputOnFocus: true,
            tags: true,
            style: {
                border: { fg: "cyan" },
                bg: "#0a0a0a",
            },
        });

        textInput.focus();
        tui.screen.render();

        textInput.on("submit", (value: string) => {
            const trimmed = value?.trim();
            closeTextInput();

            if (!trimmed) return;

            const selectedId = sidebar.selectedCallId();
            const log = selectedId
                ? (msg: string) => sidebar.logCall(selectedId, msg)
                : (msg: string) => tui.callLog.log(msg);
            const selectedCall = selectedId ? agent.calls.get(selectedId) : undefined;

            handleCommand(trimmed, {
                agent,
                instructions: "",
                log,
                selectedCall,
            });
        });

        textInput.key(["escape"], () => {
            closeTextInput();
        });
    }

    function closeTextInput(): void {
        if (textInput) {
            textInput.detach();
            textInput = null;
        }
        isOpen = false;
        tui.screen.render();
    }
}
