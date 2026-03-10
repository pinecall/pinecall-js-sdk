/**
 * Reusable console logger for Pinecall SDK examples.
 *
 * Renders a minimal terminal UI with inline-updating transcripts,
 * turn markers ([PAUSE] / [END] / [CONTINUED]), and streaming bot words.
 *
 * Usage:
 *   import { attachLogger } from "./logger.js";
 *   const detach = attachLogger(agent);
 */

import chalk from "chalk";

// ─── ANSI ────────────────────────────────────────────────────────────────

const CLEAR_LINE = "\x1b[2K";
const SHOW_CURSOR = "\x1b[?25h";

function write(text: string) {
    process.stdout.write(text);
}

function line(text: string) {
    write(`${CLEAR_LINE}\r${text}\n`);
}

function inline(text: string) {
    write(`${CLEAR_LINE}\r${text}`);
}

// ─── Per-call state ──────────────────────────────────────────────────────

interface CallState {
    t0: number;
    userText: string;
    needsNewline: boolean;   // true if current cursor is mid-line (after inline update)
    botWords: string;
    botStreaming: boolean;
}

const states = new Map<string, CallState>();

function s(callId: string): CallState {
    if (!states.has(callId)) {
        states.set(callId, {
            t0: Date.now(),
            userText: "",
            needsNewline: false,
            botWords: "",
            botStreaming: false,
        });
    }
    return states.get(callId)!;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const B = chalk.gray("│");
const DIM = chalk.dim;

function ts(): string {
    const d = new Date();
    return DIM(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`,
    );
}

function dur(t0: number): string {
    const sec = Math.round((Date.now() - t0) / 1000);
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
}

/** Ensure we're on a fresh line before writing a full line. */
function flush(st: CallState) {
    if (st.needsNewline) {
        write("\n");
        st.needsNewline = false;
    }
}

// ─── Logger ──────────────────────────────────────────────────────────────

export function attachLogger(agent: any): () => void {
    const h: Array<[string, (...a: any[]) => void]> = [];
    const on = (ev: string, fn: (...a: any[]) => void) => {
        agent.on(ev, fn);
        h.push([ev, fn]);
    };

    // ── Connection ───────────────────────────────────────────────────

    on("error", (err: any) => {
        line(`  ${chalk.red("✖")} ${chalk.red(err.message)} ${DIM(err.code || "")}`);
    });

    on("disconnected", (reason: string) => {
        line(`  ${chalk.yellow("⚡")} Disconnected: ${DIM(reason)}`);
    });

    on("reconnecting", (attempt: number) => {
        inline(`  ${chalk.yellow("↻")} Reconnecting ${DIM(`(${attempt})`)}…`);
    });

    // ── Call lifecycle ───────────────────────────────────────────────

    on("call.started", (call: any) => {
        const st = s(call.id);
        st.t0 = Date.now();
        const shortId = call.id.slice(0, 12) + "…";
        line("");
        line(chalk.gray(`┌─ Call ${DIM(shortId)} (${call.direction}) ${"─".repeat(30)}`));
        line(`${B}  ${ts()} ${DIM("call started")}`);
    });

    on("call.ended", (call: any, reason: string) => {
        const st = s(call.id);
        flush(st);
        line(B);
        line(chalk.gray(`└─ Ended (${reason}) · ${dur(st.t0)} ${"─".repeat(30)}`));
        line("");
        states.delete(call.id);
    });

    // ── User speech ──────────────────────────────────────────────────
    // user.speaking updates the SAME line via \r (no newline).
    // When a turn decision arrives (pause/eager/end), we finalize.

    on("speech.started", (_e: any, call: any) => {
        const st = s(call.id);
        flush(st);
        st.userText = "";
    });

    on("user.speaking", (event: any, call: any) => {
        const st = s(call.id);
        st.userText = event.text || "";
        inline(`${B}  ${chalk.yellow.bold("👤")} ${chalk.yellow(st.userText)} ${DIM("▍")}`);
        st.needsNewline = true;
    });

    // ── Turn decisions ───────────────────────────────────────────────

    on("turn.pause", (_e: any, call: any) => {
        const st = s(call.id);
        // Overwrite current user line with PAUSE marker
        inline(`${B}  ${chalk.yellow.bold("👤")} ${chalk.yellow(st.userText)} ${DIM("⏸ PAUSE")}`);
        st.needsNewline = true;
    });

    on("eager.turn", (turn: any, call: any) => {
        const st = s(call.id);
        st.userText = turn.text || st.userText;
        // Overwrite current line with EAGER marker
        inline(`${B}  ${chalk.yellow.bold("👤")} ${chalk.yellow(st.userText)} ${DIM("▸ EAGER")}`);
        st.needsNewline = true;
    });

    on("turn.end", (turn: any, call: any) => {
        const st = s(call.id);
        st.userText = turn.text || st.userText;
        // Finalize: overwrite current line with green END
        inline(`${B}  ${chalk.yellow.bold("👤")} ${chalk.yellow(st.userText)} ${chalk.green("✓ END")}`);
        write("\n");
        st.needsNewline = false;
    });

    on("turn.continued", (_e: any, call: any) => {
        const st = s(call.id);
        // User kept talking — overwrite with CONTINUED
        inline(`${B}  ${chalk.yellow.bold("👤")} ${chalk.yellow(st.userText)} ${chalk.magenta("⚡ CONTINUED")}`);
        write("\n");
        st.needsNewline = false;
    });

    on("turn.resumed", (_e: any, call: any) => {
        const st = s(call.id);
        st.userText = "";
    });

    // ── Bot speech ───────────────────────────────────────────────────

    on("bot.speaking", (_e: any, call: any) => {
        const st = s(call.id);
        flush(st);
        st.botWords = "";
        st.botStreaming = true;
        line(B);
        inline(`${B}  ${chalk.cyan.bold("🤖")} ${DIM("▍")}`);
        st.needsNewline = true;
    });

    on("bot.word", (event: any, call: any) => {
        const st = s(call.id);
        if (!st.botStreaming) return;
        st.botWords += (st.botWords ? " " : "") + event.word;
        inline(`${B}  ${chalk.cyan.bold("🤖")} ${chalk.cyan(st.botWords)} ${DIM("▍")}`);
        st.needsNewline = true;
    });

    on("bot.finished", (event: any, call: any) => {
        const st = s(call.id);
        st.botStreaming = false;
        // Finalize bot line (no cursor)
        inline(`${B}  ${chalk.cyan.bold("🤖")} ${chalk.cyan(st.botWords)}`);
        write("\n");
        line(`${B}       ${DIM(`✓ ${event.duration_ms || 0}ms`)}`);
        st.needsNewline = false;
    });

    on("bot.interrupted", (_e: any, call: any) => {
        const st = s(call.id);
        st.botStreaming = false;
        inline(`${B}  ${chalk.cyan.bold("🤖")} ${chalk.cyan(st.botWords)} ${chalk.red("⚡ CUT")}`);
        write("\n");
        st.needsNewline = false;
    });

    // ── Misc ─────────────────────────────────────────────────────────

    on("reply.rejected", (event: any) => {
        line(`${B}  ${chalk.red("✖ rejected:")} ${DIM(event.reason || "")}`);
    });

    // Cursor cleanup
    const restore = () => write(SHOW_CURSOR);
    process.on("exit", restore);
    process.on("SIGINT", () => { restore(); process.exit(130); });

    return () => {
        for (const [ev, fn] of h) agent.off(ev, fn);
    };
}
