/**
 * Renderer — low-level terminal output utilities.
 * Handles formatted logging, headers, config display, and timestamps.
 */

import chalk from "chalk";
import {
    BRAND, ACCENT, OK, ERR, WARN, MUTED, DIM,
    BAR, CHECK, CROSS, BULLET, ARROW, PHONE, SPARKLE,
    CLEAR_LINE, SHOW_CURSOR,
} from "./theme.js";

// ── Core write functions ─────────────────────────────────────────────────

/** Write a line to stdout with the bar prefix. */
export function logLine(msg: string): void {
    process.stdout.write(`  ${BAR} ${msg}\n`);
}

/** Write raw text to stdout. */
export function write(text: string): void {
    process.stdout.write(text);
}

/** Write a line to stdout. */
export function writeln(text: string): void {
    process.stdout.write(text + "\n");
}

/** Clear the current line and write inline (for live-updating text). */
export function writeInline(text: string): void {
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

/** Print the CLI header banner. */
export function printHeader(title: string): void {
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
    write(SHOW_CURSOR);
}
