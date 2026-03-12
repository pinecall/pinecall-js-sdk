/**
 * TUI screen manager — blessed split-pane layout.
 *
 * ┌──────────┬──────── Call Events ────────┬──────── LLM / Tools ────────┐
 * │ Sidebar  │                             │                             │
 * ├──────────┴─────────────────────────────┴─────────────────────────────┤
 * │ › input                                              N calls ● Live │
 * └─────────────────────────────────────────────────────────────────────-┘
 */

import blessed from "blessed";

// ── Exported interface ───────────────────────────────────────────────────

export interface TUI {
    screen: blessed.Widgets.Screen;
    sidebar: blessed.Widgets.BoxElement;
    callLog: blessed.Widgets.Log;
    llmLog: blessed.Widgets.Log;
    hintBar: blessed.Widgets.BoxElement;
    status: blessed.Widgets.TextElement;
    destroy(): void;
}

// ── Layout constants ─────────────────────────────────────────────────────

const SIDEBAR_WIDTH = 20;
const BOTTOM_HEIGHT = 1;
const STATUS_WIDTH = 20;

// ── Factory ──────────────────────────────────────────────────────────────

export function createTUI(): TUI {
    const screen = blessed.screen({
        smartCSR: true,
        title: "⚡ pinecall",
        fullUnicode: true,
    });

    // ── Sidebar (fixed left) ──
    const sidebar = blessed.box({
        parent: screen,
        label: " {bold}CALLS{/bold} ",
        top: 0,
        left: 0,
        width: SIDEBAR_WIDTH,
        height: `100%-${BOTTOM_HEIGHT}`,
        border: { type: "line" },
        scrollable: true,
        tags: true,
        style: {
            border: { fg: "gray" },
            label: { fg: "white", bold: true },
        },
    });

    // ── Call events (center) ──
    const callLog = blessed.log({
        parent: screen,
        label: " Call Events ",
        top: 0,
        left: SIDEBAR_WIDTH,
        width: `50%-${Math.floor(SIDEBAR_WIDTH / 2)}`,
        height: `100%-${BOTTOM_HEIGHT}`,
        border: { type: "line" },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { style: { bg: "cyan" } },
        tags: true,
        style: {
            border: { fg: "gray" },
            label: { fg: "cyan" },
        },
    });

    // ── LLM / Tools (right) ──
    const llmLog = blessed.log({
        parent: screen,
        label: " LLM / Tools ",
        top: 0,
        left: `50%+${Math.floor(SIDEBAR_WIDTH / 2)}`,
        width: `50%-${Math.floor(SIDEBAR_WIDTH / 2)}`,
        height: `100%-${BOTTOM_HEIGHT}`,
        border: { type: "line" },
        scrollable: true,
        alwaysScroll: true,
        scrollbar: { style: { bg: "magenta" } },
        tags: true,
        style: {
            border: { fg: "gray" },
            label: { fg: "magenta" },
        },
    });

    // ── Hint bar (bottom left) ──
    const hintBar = blessed.box({
        parent: screen,
        bottom: 0,
        left: 0,
        width: `100%-${STATUS_WIDTH}`,
        height: BOTTOM_HEIGHT,
        content: " {gray-fg}Ctrl+O{/gray-fg} Commands  {gray-fg}Ctrl+T{/gray-fg} Type  {gray-fg}Ctrl+Y{/gray-fg} Copy LLM  {gray-fg}↑↓{/gray-fg} Nav",
        tags: true,
        style: {
            bg: "black",
        },
    });

    const status = blessed.text({
        parent: screen,
        bottom: 0,
        right: 0,
        width: STATUS_WIDTH,
        height: BOTTOM_HEIGHT,
        content: "{green-fg}●{/green-fg} Live",
        align: "center",
        tags: true,
        style: {
            bg: "black",
        },
    });

    // ── Responsive layout ──
    screen.on("resize", () => {
        const w = (screen.width as number);
        if (w < 80) {
            // Very narrow: hide sidebar, stack vertically
            sidebar.hide();
            callLog.left = 0;
            callLog.width = "100%";
            callLog.height = `50%-${Math.floor(BOTTOM_HEIGHT / 2)}`;
            llmLog.left = 0;
            llmLog.top = `50%-${Math.floor(BOTTOM_HEIGHT / 2)}`;
            llmLog.width = "100%";
            llmLog.height = `50%-${Math.ceil(BOTTOM_HEIGHT / 2)}`;
        } else {
            sidebar.show();
            callLog.left = SIDEBAR_WIDTH;
            callLog.width = `50%-${Math.floor(SIDEBAR_WIDTH / 2)}`;
            callLog.height = `100%-${BOTTOM_HEIGHT}`;
            llmLog.left = `50%+${Math.floor(SIDEBAR_WIDTH / 2)}`;
            llmLog.top = 0;
            llmLog.width = `50%-${Math.floor(SIDEBAR_WIDTH / 2)}`;
            llmLog.height = `100%-${BOTTOM_HEIGHT}`;
        }
        screen.render();
    });

    // ── Global keys ──
    screen.key(["C-c"], () => process.exit(0));
    screen.render();

    return {
        screen,
        sidebar,
        callLog,
        llmLog,
        hintBar,
        status,
        destroy: () => screen.destroy(),
    };
}
