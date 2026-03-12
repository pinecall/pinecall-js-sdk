/**
 * TUI sidebar — call list with ↑↓ keyboard navigation.
 *
 * Each call is tracked with its own log buffers (callLines, llmLines).
 * When the user selects a call, the center/right panes are replayed
 * from that call's buffer.
 */

import type { TUI } from "./tui.js";

// ── Per-call data ────────────────────────────────────────────────────────

interface SidebarCall {
    callId: string;
    from: string;
    startTime: number;
    ended: boolean;
    endReason?: string;
    callLines: string[];
    llmLines: string[];
}

// ── Exported interface ───────────────────────────────────────────────────

export interface CallSidebar {
    addCall(callId: string, from: string): void;
    endCall(callId: string): void;
    selectedCallId(): string | null;
    moveUp(): void;
    moveDown(): void;
    logCall(callId: string, line: string): void;
    updateLastCallLine(callId: string, line: string): void;
    logLLM(callId: string, line: string): void;
    updateLastLLMLine(callId: string, line: string): void;
    callCount(): number;
    getLLMLines(): string[];
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createCallSidebar(tui: TUI): CallSidebar {
    const calls: SidebarCall[] = [];
    let selectedIndex = -1;
    let durationTimer: ReturnType<typeof setInterval> | null = null;

    // ── Render the sidebar list ──
    function render(): void {
        const lines: string[] = [];
        for (let i = 0; i < calls.length; i++) {
            const c = calls[i];
            const selected = i === selectedIndex;
            const marker = selected ? "▶" : " ";
            const phone = formatPhone(c.from);
            const elapsed = formatElapsed(c.startTime);

            if (c.ended) {
                lines.push(`{gray-fg}${marker} ${phone}{/gray-fg}`);
                lines.push(`{gray-fg}  ${elapsed} ✗{/gray-fg}`);
            } else {
                const phoneColor = selected ? "{cyan-fg}" : "{white-fg}";
                lines.push(`${phoneColor}${marker} ${phone}{/}`);
                lines.push(`  ${elapsed}`);
            }

            if (i < calls.length - 1) {
                lines.push("{gray-fg}────────────────{/gray-fg}");
            }
        }

        tui.sidebar.setContent(lines.join("\n"));
        tui.screen.render();
    }

    // ── Swap pane content to selected call ──
    function swapPanes(): void {
        // Clear panes
        (tui.callLog as any).setContent("");
        (tui.llmLog as any).setContent("");

        if (selectedIndex < 0 || selectedIndex >= calls.length) return;

        const c = calls[selectedIndex];
        for (const line of c.callLines) {
            tui.callLog.log(line);
        }
        for (const line of c.llmLines) {
            tui.llmLog.log(line);
        }
        tui.screen.render();
    }

    // ── Update status badge ──
    function updateStatus(): void {
        const active = calls.filter((c) => !c.ended).length;
        const total = calls.length;
        const label = total === 1 ? "call" : "calls";
        if (active > 0) {
            tui.status.setContent(`${total} ${label}  {green-fg}●{/green-fg} Live`);
        } else if (total > 0) {
            tui.status.setContent(`${total} ${label}  {gray-fg}●{/gray-fg} Idle`);
        } else {
            tui.status.setContent("{green-fg}●{/green-fg} Waiting");
        }
        tui.screen.render();
    }

    // ── Navigation helpers (called from tui-input) ──
    function moveUp(): void {
        if (calls.length === 0) return;
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        swapPanes();
    }

    function moveDown(): void {
        if (calls.length === 0) return;
        selectedIndex = Math.min(calls.length - 1, selectedIndex + 1);
        render();
        swapPanes();
    }

    // ── Duration timer — update sidebar every second ──
    durationTimer = setInterval(() => {
        if (calls.some((c) => !c.ended)) {
            render();
        }
    }, 1000);

    // Clean up on exit
    tui.screen.on("destroy", () => {
        if (durationTimer) clearInterval(durationTimer);
    });

    // ── Public API ───────────────────────────────────────────────────────

    return {
        addCall(callId: string, from: string): void {
            // Insert new call at the top
            calls.unshift({
                callId,
                from,
                startTime: Date.now(),
                ended: false,
                callLines: [],
                llmLines: [],
            });

            // If selected call is ended (or no selection), auto-select the new one
            const selectedEnded = selectedIndex >= 0 && calls[selectedIndex + 1]?.ended;
            if (calls.length === 1 || selectedEnded || selectedIndex < 0) {
                selectedIndex = 0;
                swapPanes();
            } else {
                // Shift index to keep current selection
                selectedIndex += 1;
            }

            render();
            updateStatus();
        },

        endCall(callId: string): void {
            const c = calls.find((x) => x.callId === callId);
            if (c) {
                c.ended = true;
            }
            render();
            updateStatus();
        },

        selectedCallId(): string | null {
            if (selectedIndex < 0 || selectedIndex >= calls.length) return null;
            return calls[selectedIndex].callId;
        },

        moveUp,
        moveDown,

        logCall(callId: string, line: string): void {
            const c = calls.find((x) => x.callId === callId);
            if (!c) return;
            c.callLines.push(line);

            if (c.callId === calls[selectedIndex]?.callId) {
                tui.callLog.log(line);
                tui.screen.render();
            }
        },

        updateLastCallLine(callId: string, line: string): void {
            const c = calls.find((x) => x.callId === callId);
            if (!c || c.callLines.length === 0) return;
            c.callLines[c.callLines.length - 1] = line;

            if (c.callId === calls[selectedIndex]?.callId) {
                // Re-render the entire pane from buffer
                (tui.callLog as any).setContent("");
                for (const l of c.callLines) {
                    tui.callLog.log(l);
                }
                tui.screen.render();
            }
        },

        logLLM(callId: string, line: string): void {
            const c = calls.find((x) => x.callId === callId);
            if (!c) return;
            c.llmLines.push(line);

            if (c.callId === calls[selectedIndex]?.callId) {
                tui.llmLog.log(line);
                tui.screen.render();
            }
        },

        updateLastLLMLine(callId: string, line: string): void {
            const c = calls.find((x) => x.callId === callId);
            if (!c || c.llmLines.length === 0) return;
            c.llmLines[c.llmLines.length - 1] = line;

            if (c.callId === calls[selectedIndex]?.callId) {
                (tui.llmLog as any).setContent("");
                for (const l of c.llmLines) {
                    tui.llmLog.log(l);
                }
                tui.screen.render();
            }
        },

        callCount(): number {
            return calls.length;
        },

        /** Get raw LLM lines for the selected call (for clipboard). */
        getLLMLines(): string[] {
            if (selectedIndex < 0 || selectedIndex >= calls.length) return [];
            return calls[selectedIndex].llmLines;
        },
    };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatPhone(phone: string): string {
    // Show full number, just trim the + for compact display
    return phone;
}

function formatElapsed(startTime: number): string {
    const s = Math.floor((Date.now() - startTime) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m${rem.toString().padStart(2, "0")}s`;
}
