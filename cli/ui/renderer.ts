/**
 * Renderer — low-level terminal output utilities.
 * Handles formatted logging, headers, config display, and timestamps.
 *
 * All output functions clear the readline prompt before writing
 * and redraw it after, so events never mix with the prompt line.
 */

import chalk from "chalk";
import {
    BRAND, ACCENT, OK, ERR, WARN, MUTED, DIM,
    BAR, CHECK, CROSS, BULLET, ARROW, PHONE, SPARKLE,
    CLEAR_LINE, SHOW_CURSOR,
} from "./theme.js";

// Lazy import to avoid circular dependency at module load time.
// input.ts imports renderer.ts, so we defer the reverse import.
let _promptFns: { clearPrompt: () => void; redrawPrompt: () => void } | null = null;

function getPromptFns() {
    if (!_promptFns) {
        try {
            // Dynamic import at first use — by this time input.ts is fully loaded.
            const mod = require("./input.js");
            _promptFns = { clearPrompt: mod.clearPrompt, redrawPrompt: mod.redrawPrompt };
        } catch {
            _promptFns = { clearPrompt: () => {}, redrawPrompt: () => {} };
        }
    }
    return _promptFns;
}

// ── Core write functions ─────────────────────────────────────────────────

/** Write a line to stdout with the bar prefix, prompt-aware. */
export function logLine(msg: string): void {
    const { clearPrompt, redrawPrompt } = getPromptFns();
    clearPrompt();
    process.stdout.write(`  ${BAR} ${msg}\n`);
    redrawPrompt();
}

/**
 * Write raw text to stdout.
 * NOT prompt-aware — used for streaming tokens and partial output
 * where clearing/redrawing the prompt would erase the content.
 */
export function write(text: string): void {
    process.stdout.write(text);
}

/** Write a line to stdout, prompt-aware. */
export function writeln(text: string): void {
    const { clearPrompt, redrawPrompt } = getPromptFns();
    clearPrompt();
    process.stdout.write(text + "\n");
    redrawPrompt();
}

/**
 * Clear the current line and write inline (for live-updating text like user.speaking).
 * Clears prompt but does NOT redraw — the next logLine/writeln will redraw it.
 */
export function writeInline(text: string): void {
    const { clearPrompt } = getPromptFns();
    clearPrompt();
    process.stdout.write(CLEAR_LINE + text);
}

// ── Timestamps & durations ───────────────────────────────────────────────

/** Format current time as HH:MM:SS. */
export function ts(): string {
    return MUTED(new Date().toLocaleTimeString("en-US", { hour12: false }));
}

/** Format milliseconds as "1.2s" or "800ms". */
export function dur(ms: number): string {
    if (ms >= 1000) return MUTED(`${(ms / 1000).toFixed(1)}s`);
    return MUTED(`${Math.round(ms)}ms`);
}

// ── Formatted output ─────────────────────────────────────────────────────

/** Print the CLI header banner. Clears the terminal first. */
export function printHeader(title: string): void {
    process.stdout.write("\x1Bc"); // clear terminal
    writeln("");
    writeln(`  ${BRAND("⚡ pinecall")} ${DIM("—")} ${title}`);
    writeln(`  ${MUTED("─".repeat(Math.min(process.stdout.columns || 80, 60)))}`);
}

/** Print a key-value config pair. */
export function printConfigLine(key: string, value: string): void {
    logLine(`${MUTED(key.padEnd(12))} ${value}`);
}

/** Print a success status line. */
export function printStatus(label: string, detail?: string): void {
    const d = detail ? ` ${MUTED(detail)}` : "";
    logLine(`${CHECK} ${label}${d}`);
}

/** Print an error status line. */
export function printError(label: string, detail?: string): void {
    const d = detail ? ` ${MUTED(detail)}` : "";
    logLine(`${CROSS} ${ERR(label)}${d}`);
}

/** Print a warning status line. */
export function printWarn(label: string, detail?: string): void {
    const d = detail ? ` ${MUTED(detail)}` : "";
    logLine(`${WARN("!")} ${WARN(label)}${d}`);
}

/** Print agent config summary after startup. */
export function printConfig(opts: {
    phone: string;
    voice: string;
    stt: string;
    turnDetection: string;
    model: string;
    lang: string;
}): void {
    writeln("");
    printConfigLine("Phone", `${PHONE}  ${ACCENT(opts.phone)}`);
    printConfigLine("Voice", opts.voice);
    printConfigLine("STT", opts.stt);
    printConfigLine("Turn", `${opts.turnDetection} ${ARROW} ${opts.model}`);
    printConfigLine("Language", opts.lang);
    writeln(`  ${MUTED("─".repeat(Math.min(process.stdout.columns || 80, 60)))}`);
    writeln("");
}

/** Show cursor on process exit (prevents terminal corruption). */
export function ensureCursor(): void {
    process.stdout.write(SHOW_CURSOR);
}
