/**
 * Interactive terminal UI for Pinecall CLI.
 *
 * Renders a clean, minimal console with:
 *   - Full-screen clear on launch
 *   - Live call transcript (user 👤  / bot 🤖)
 *   - Command input bar at the bottom
 *   - Slash commands: /reply, /forward, /dtmf, /hold, /unhold, /mute, /unmute, /hangup, /help
 *
 * Uses only chalk + readline — zero extra dependencies.
 */

import chalk from "chalk";
import * as readline from "node:readline";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── ANSI helpers ────────────────────────────────────────────────────────

const ESC = "\x1b";
const CLEAR_LINE = `${ESC}[2K`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

function write(text: string) {
    process.stdout.write(text);
}

function writeln(text: string) {
    write(`${CLEAR_LINE}\r${text}\n`);
}

function writeInline(text: string) {
    write(`${CLEAR_LINE}\r${text}`);
}

// ─── Colors & symbols ───────────────────────────────────────────────────

const DIM = chalk.dim;
const BRAND = chalk.hex("#7C3AED");       // vivid purple
const ACCENT = chalk.hex("#06B6D4");      // cyan-ish
const WARN = chalk.hex("#F59E0B");       // amber
const OK = chalk.hex("#10B981");       // emerald
const ERR = chalk.hex("#EF4444");       // red
const MUTED = chalk.hex("#64748B");       // slate

const BAR = MUTED("│");
const DOT = MUTED("·");

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

// ─── Per-call state ─────────────────────────────────────────────────────

interface CallState {
    t0: number;
    userText: string;
    needsNewline: boolean;
    botWords: string;
    botStreaming: boolean;
    botMessageId: string;
    held: boolean;
    muted: boolean;
}

const states = new Map<string, CallState>();

function st(callId: string): CallState {
    if (!states.has(callId)) {
        states.set(callId, {
            t0: Date.now(),
            userText: "",
            needsNewline: false,
            botWords: "",
            botStreaming: false,
            botMessageId: "",
            held: false,
            muted: false,
        });
    }
    return states.get(callId)!;
}

function flush(s: CallState) {
    if (s.needsNewline) {
        write("\n");
        s.needsNewline = false;
    }
}

// ─── Command definitions ────────────────────────────────────────────────

interface CmdDef {
    usage: string;
    desc: string;
}

const COMMANDS: Record<string, CmdDef> = {
    reply: { usage: "/reply <text>", desc: "Send a text reply to the caller" },
    forward: { usage: "/forward <number>", desc: "Forward the call to another number" },
    dtmf: { usage: "/dtmf <digits>", desc: "Send DTMF tones (e.g. 123#)" },
    hold: { usage: "/hold", desc: "Put the call on hold" },
    unhold: { usage: "/unhold", desc: "Take the call off hold" },
    mute: { usage: "/mute", desc: "Mute the mic" },
    unmute: { usage: "/unmute", desc: "Unmute the mic" },
    hangup: { usage: "/hangup", desc: "Hang up the call" },
    instructions: { usage: "/instructions", desc: "Edit the system prompt in $EDITOR" },
    clear: { usage: "/clear", desc: "Clear the terminal" },
    help: { usage: "/help", desc: "Show available commands" },
};

// ─── Header & Help ──────────────────────────────────────────────────────

function printHeader(title: string, subtitle?: string) {
    const w = process.stdout.columns || 80;
    const line = MUTED("─".repeat(w));

    write("\x1b[2J\x1b[H"); // clear screen + cursor to top
    writeln("");
    writeln(`  ${BRAND.bold("⚡ Pinecall")} ${DIM("·")} ${chalk.white.bold(title)}`);
    if (subtitle) writeln(`  ${DIM(subtitle)}`);
    writeln(line);
    writeln("");
}

function printHelp() {
    writeln("");
    writeln(`  ${BRAND.bold("Commands")}`);
    writeln("");
    for (const [, cmd] of Object.entries(COMMANDS)) {
        writeln(`  ${ACCENT(cmd.usage.padEnd(24))} ${DIM(cmd.desc)}`);
    }
    writeln("");
}

function printStatus(label: string, value: string) {
    writeln(`  ${OK("✓")} ${chalk.white(label)}  ${DIM(value)}`);
}

// ─── Config display ─────────────────────────────────────────────────────

export interface ConfigInfo {
    stt?: string;
    tts?: string;
    turn?: string;
    llm?: string;
    [key: string]: string | undefined;
}

function printConfig(config: ConfigInfo) {
    writeln("");

    const entries = Object.entries(config).filter(([, v]) => v);
    const maxLen = Math.max(...entries.map(([k]) => k.length));

    for (const [key, value] of entries) {
        const label = key.toUpperCase().padEnd(maxLen + 1);
        writeln(`  ${MUTED(label)} ${chalk.white(value)}`);
    }

    writeln("");
}

// ─── Main export ────────────────────────────────────────────────────────

export interface UIOptions {
    title: string;
    subtitle?: string;
    /** Called when user runs /instructions. Should return the current system prompt. */
    getInstructions?: () => string;
    /** Called after user edits the prompt in $EDITOR. Receives the new prompt. */
    setInstructions?: (prompt: string) => void;
}

export interface UI {
    /** Attach event logger + command input to an agent. Call after connect. */
    attach(agent: any, activeCall?: any): void;
    /** Print a status line */
    status(label: string, value: string): void;
    /** Print header */
    header(): void;
    /** Print active config (STT, TTS, Turn, LLM) */
    config(info: ConfigInfo): void;
    /** Prompt string for waiting */
    waiting(): void;
}

export function createUI(opts: UIOptions): UI {
    let activeCall: any = null;
    let rl: readline.Interface | null = null;

    // ── Prompt ───────────────────────────────────────────────────────

    const PROMPT = `  ${MUTED("›")} `;

    function showPrompt() {
        if (rl) rl.prompt();
    }

    function logLine(text: string) {
        // Clear current input line, print message, then re-show prompt
        if (rl) {
            writeInline("");
            writeln(text);
            showPrompt();
        } else {
            writeln(text);
        }
    }

    // ── Command handler ─────────────────────────────────────────────

    function handleCommand(input: string) {
        const trimmed = input.trim();
        if (!trimmed) return;

        if (!trimmed.startsWith("/")) {
            // Treat raw text as /reply
            if (!activeCall) {
                logLine(`  ${WARN("⚠")} No active call`);
                return;
            }
            activeCall.reply(trimmed);
            logLine(`  ${OK("→")} ${chalk.white("reply:")} ${DIM(trimmed)}`);
            return;
        }

        const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
        const arg = rest.join(" ");

        if (!activeCall && cmd !== "help" && cmd !== "clear" && cmd !== "instructions") {
            logLine(`  ${WARN("⚠")} No active call`);
            return;
        }

        switch (cmd) {
            case "reply":
            case "r":
                if (!arg) { logLine(`  ${WARN("⚠")} Usage: /reply <text>`); break; }
                activeCall.reply(arg);
                logLine(`  ${OK("→")} ${chalk.white("reply:")} ${DIM(arg)}`);
                break;

            case "forward":
            case "fwd":
                if (!arg) { logLine(`  ${WARN("⚠")} Usage: /forward +1234567890`); break; }
                activeCall.forward(arg);
                logLine(`  ${OK("→")} ${chalk.white("forward:")} ${DIM(arg)}`);
                break;

            case "dtmf":
                if (!arg) { logLine(`  ${WARN("⚠")} Usage: /dtmf 123#`); break; }
                activeCall.sendDTMF(arg);
                logLine(`  ${OK("→")} ${chalk.white("dtmf:")} ${DIM(arg)}`);
                break;

            case "hold":
                activeCall.hold();
                logLine(`  ${WARN("⏸")} ${chalk.white("Call on hold")}`);
                break;

            case "unhold":
                activeCall.unhold();
                logLine(`  ${OK("▶")} ${chalk.white("Call resumed")}`);
                break;

            case "mute":
                activeCall.mute();
                logLine(`  ${WARN("🔇")} ${chalk.white("Mic muted")}`);
                break;

            case "unmute":
                activeCall.unmute();
                logLine(`  ${OK("🔊")} ${chalk.white("Mic unmuted")}`);
                break;

            case "hangup":
            case "bye":
                activeCall.hangup();
                logLine(`  ${ERR("✖")} ${chalk.white("Hanging up…")}`);
                break;

            case "clear":
            case "cls":
                write("\x1b[2J\x1b[H");
                printHeader(opts.title, opts.subtitle);
                break;

            case "instructions":
            case "inst": {
                if (!opts.getInstructions || !opts.setInstructions) {
                    logLine(`  ${WARN("⚠")} Instructions not available`);
                    break;
                }

                const editor = process.env.EDITOR || process.env.VISUAL || "vi";
                const tmpFile = join(tmpdir(), `pinecall-instructions-${Date.now()}.md`);

                try {
                    writeFileSync(tmpFile, opts.getInstructions(), "utf-8");

                    // Pause readline so the editor gets full stdin control
                    rl?.pause();
                    write(SHOW_CURSOR);

                    execSync(`${editor} ${tmpFile}`, { stdio: "inherit" });

                    const updated = readFileSync(tmpFile, "utf-8").trim();
                    unlinkSync(tmpFile);

                    if (updated && updated !== opts.getInstructions()) {
                        opts.setInstructions(updated);
                        logLine(`  ${OK("✓")} ${chalk.white("Instructions updated")} ${DIM(`(${updated.length} chars)`)}`);
                    } else {
                        logLine(`  ${DIM("No changes")}`);
                    }
                } catch (err: any) {
                    logLine(`  ${ERR("✖")} Editor failed: ${DIM(err.message)}`);
                    try { unlinkSync(tmpFile); } catch { }
                } finally {
                    rl?.resume();
                    showPrompt();
                }
                break;
            }

            case "help":
            case "?":
                printHelp();
                break;

            default:
                logLine(`  ${ERR("✖")} Unknown command: ${DIM("/" + cmd)}  ${DIM("(type /help)")}`);
        }
    }

    // ── Start readline ──────────────────────────────────────────────

    function startInput() {
        rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: PROMPT,
            terminal: true,
        });

        // Suppress the default ^C echo
        rl.on("SIGINT", () => {
            write(SHOW_CURSOR);
            writeln(`\n  ${DIM("Bye! 👋")}\n`);
            process.exit(0);
        });

        rl.on("line", (line: string) => {
            handleCommand(line);
            showPrompt();
        });

        showPrompt();
    }

    // ── Event logger (attaches to agent) ────────────────────────────

    function attach(agent: any, initialCall?: any) {
        if (initialCall) activeCall = initialCall;

        const on = (ev: string, fn: (...a: any[]) => void) => {
            agent.on(ev, fn);
        };

        // ── Connection events ────────────────────────────────────────

        on("error", (err: any) => {
            logLine(`  ${ERR("✖")} ${ERR(err.message)} ${DIM(err.code || "")}`);
        });

        on("disconnected", (reason: string) => {
            logLine(`  ${WARN("⚡")} ${chalk.white("Disconnected:")} ${DIM(reason)}`);
        });

        on("reconnecting", (attempt: number) => {
            logLine(`  ${WARN("↻")} ${chalk.white("Reconnecting")} ${DIM(`(${attempt})`)}…`);
        });

        // ── Call lifecycle ─────────────────────────────────────────

        on("call.started", (call: any) => {
            activeCall = call;
            const cs = st(call.id);
            cs.t0 = Date.now();
            const shortId = call.id.slice(0, 12) + "…";

            logLine("");
            logLine(MUTED(`  ┌─ Call ${DIM(shortId)} (${call.direction}) ${"─".repeat(30)}`));
            logLine(`  ${BAR}  ${ts()} ${DIM("call started")}`);
            logLine(`  ${BAR}`);
        });

        on("call.ended", (call: any, reason: string) => {
            const cs = st(call.id);
            flush(cs);

            logLine(`  ${BAR}`);
            logLine(MUTED(`  └─ Ended (${reason}) · ${dur(cs.t0)} ${"─".repeat(30)}`));
            logLine("");

            states.delete(call.id);
            if (activeCall?.id === call.id) activeCall = null;
        });

        // ── User speech ──────────────────────────────────────────────

        on("speech.started", (_e: any, call: any) => {
            const cs = st(call.id);
            flush(cs);
            cs.userText = "";
        });

        on("user.speaking", (event: any, call: any) => {
            const cs = st(call.id);
            cs.userText = event.text || "";
            writeInline(`  ${BAR}  ${chalk.yellow.bold("👤")} ${chalk.yellow(cs.userText)} ${DIM("▍")}`);
            cs.needsNewline = true;
        });

        // ── Turn decisions ──────────────────────────────────────────

        on("turn.pause", (_e: any, call: any) => {
            const cs = st(call.id);
            writeInline(`  ${BAR}  ${chalk.yellow.bold("👤")} ${chalk.yellow(cs.userText)} ${DIM("⏸ PAUSE")}`);
            cs.needsNewline = true;
        });

        on("eager.turn", (turn: any, call: any) => {
            const cs = st(call.id);
            cs.userText = turn.text || cs.userText;
            writeInline(`  ${BAR}  ${chalk.yellow.bold("👤")} ${chalk.yellow(cs.userText)} ${DIM("▸ EAGER")}`);
            cs.needsNewline = true;
        });

        on("turn.end", (turn: any, call: any) => {
            const cs = st(call.id);
            cs.userText = turn.text || cs.userText;
            writeInline(`  ${BAR}  ${chalk.yellow.bold("👤")} ${chalk.yellow(cs.userText)} ${OK("✓ END")}`);
            write("\n");
            cs.needsNewline = false;
            showPrompt();
        });

        on("turn.continued", (_e: any, call: any) => {
            const cs = st(call.id);
            writeInline(`  ${BAR}  ${chalk.yellow.bold("👤")} ${chalk.yellow(cs.userText)} ${chalk.magenta("⚡ CONTINUED")}`);
            write("\n");
            cs.needsNewline = false;
            showPrompt();
        });

        on("turn.resumed", (_e: any, call: any) => {
            const cs = st(call.id);
            cs.userText = "";
        });

        // ── Bot speech ──────────────────────────────────────────────

        on("bot.speaking", (e: any, call: any) => {
            const cs = st(call.id);
            flush(cs);
            cs.botWords = "";
            cs.botStreaming = true;
            cs.botMessageId = e.message_id || "";
            logLine(`  ${BAR}`);
            writeInline(`  ${BAR}  ${ACCENT.bold("🤖")} ${DIM("▍")}`);
            cs.needsNewline = true;
        });

        on("bot.word", (event: any, call: any) => {
            const cs = st(call.id);
            if (!cs.botStreaming) return;
            cs.botWords += (cs.botWords ? " " : "") + event.word;
            writeInline(`  ${BAR}  ${ACCENT.bold("🤖")} ${ACCENT(cs.botWords)} ${DIM("▍")}`);
            cs.needsNewline = true;
        });

        on("bot.finished", (event: any, call: any) => {
            const cs = st(call.id);
            // Ignore late finish for a previous message
            if (event.message_id && event.message_id !== cs.botMessageId) return;
            cs.botStreaming = false;
            writeInline(`  ${BAR}  ${ACCENT.bold("🤖")} ${ACCENT(cs.botWords)}`);
            write("\n");
            logLine(`  ${BAR}       ${DIM(`✓ ${event.duration_ms || 0}ms`)}`);
            cs.needsNewline = false;
        });

        on("bot.interrupted", (e: any, call: any) => {
            const cs = st(call.id);
            // Ignore late interrupt for a previous message — don't overwrite current display
            if (e.message_id && e.message_id !== cs.botMessageId) return;
            cs.botStreaming = false;
            writeInline(`  ${BAR}  ${ACCENT.bold("🤖")} ${ACCENT(cs.botWords)} ${ERR("⚡ CUT")}`);
            write("\n");
            cs.needsNewline = false;
            showPrompt();
        });

        // ── Misc ─────────────────────────────────────────────────────

        on("reply.rejected", (event: any) => {
            logLine(`  ${BAR}  ${ERR("✖ rejected:")} ${DIM(event.reason || "")}`);
        });

        // ── Cleanup ──────────────────────────────────────────────────

        const restore = () => write(SHOW_CURSOR);
        process.on("exit", restore);
        process.on("SIGINT", () => { restore(); process.exit(130); });

        // Start command input
        startInput();
    }

    return {
        attach,
        status: printStatus,
        config: printConfig,
        header() { printHeader(opts.title, opts.subtitle); },
        waiting() {
            writeln(`  ${DIM("Waiting for calls…  Type")} ${ACCENT("/help")} ${DIM("to see commands.")}`);
            writeln("");
        },
    };
}
