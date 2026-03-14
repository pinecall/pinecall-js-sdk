/**
 * Slash command dispatch — handles user commands during an active call session.
 *
 * Each command is a named handler in a registry, not inline in a switch.
 * Supports an optional `log` callback and `selectedCall` for TUI integration.
 */

import type { Agent, Call, Pinecall } from "@pinecall/sdk";
import { fetchVoices } from "@pinecall/sdk";
import { MUTED, OK, WARN, ERR, DIM, ACCENT } from "./theme.js";
import { logLine, writeln } from "./renderer.js";
import { getActiveCalls, getSelectedCall, selectCall, getCallLabel } from "./events.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface CommandContext {
    agent: Agent;
    /** Pinecall client (for /phones, /voices). */
    pc?: Pinecall;
    /** All loaded agents (for multi-agent /dial). Key = agent name/id. */
    agents?: Map<string, Agent>;
    instructions: string;
    log?: (msg: string) => void;
    /** Returns raw LLM history for a call (JSON-serializable messages array). */
    getHistory?: (callId: string) => unknown[] | undefined;
}

interface CommandDef {
    description: string;
    usage?: string;
    handler: (ctx: CommandContext, args: string[]) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Get selected call or the only active call. */
function resolveCall(ctx: CommandContext): Call | null {
    const selected = getSelectedCall();
    if (selected) return selected;
    const calls = ctx.agent.calls;
    if (calls.size === 1) return [...calls.values()][0];
    return null;
}

// ── Command handlers ─────────────────────────────────────────────────────

function handleHelp(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const calls = getActiveCalls();
    const hasCalls = calls.size > 0;

    log(`${DIM("── General ──")}`);
    log(`  ${MUTED("/phones")}     ${DIM("List phone numbers")}`);
    log(`  ${MUTED("/voices")}     ${DIM("List TTS voices")}`);
    log(`  ${MUTED("/play")}       ${DIM("Play voice preview")} ${DIM("<name|id> [provider]")}`);
    log(`  ${MUTED("/dial")}       ${DIM("Outbound call")} ${DIM("[agent] +number [\"greeting\"]")}`);

    if (hasCalls) {
        log(`${DIM("── Active call" + (calls.size > 1 ? "s" : "") + " ──")}`);
        log(`  ${MUTED("/calls")}      ${DIM("List active calls")}`);
        if (calls.size > 1) log(`  ${MUTED("/switch")}     ${DIM("Select active call")} ${DIM("<1|sid>")}`);
        log(`  ${MUTED("/config")}     ${DIM("Change call config")} ${DIM("<voice|stt|turn|lang> <val>")}`);
        log(`  ${MUTED("/hangup")}     ${DIM("Hang up call")}`);
        log(`  ${MUTED("/hold")}       ${DIM("Put on hold")}`);
        log(`  ${MUTED("/unhold")}     ${DIM("Resume held call")}`);
        log(`  ${MUTED("/mute")}       ${DIM("Mute microphone")}`);
        log(`  ${MUTED("/unmute")}     ${DIM("Unmute microphone")}`);
        log(`  ${MUTED("/history")}    ${DIM("Show raw LLM history")}`);
    } else {
        log(`${DIM("── No active calls ──")}`);
        log(`  ${DIM("Use /dial to make a call, or wait for an inbound call.")}`);
    }
}

function handleHangup(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (call) {
        call.hangup();
        log(`${OK("✓")} Hanging up ${DIM(call.id.slice(0, 12))}`);
        return;
    }
    const calls = ctx.agent.calls;
    if (calls.size === 0) {
        log(`${WARN("No active calls")}`);
        return;
    }
    for (const c of calls.values()) {
        c.hangup();
        log(`${OK("✓")} Hanging up ${DIM(c.id.slice(0, 12))}`);
    }
}

function handleHold(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (call) { call.hold(); log(`${OK("✓")} Call on hold`); }
    else log(`${WARN("No active calls")}`);
}

function handleUnhold(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (call) { call.unhold(); log(`${OK("✓")} Call resumed`); }
    else log(`${WARN("No active calls")}`);
}

function handleMute(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (call) { call.mute(); log(`${OK("✓")} Mic muted`); }
    else log(`${WARN("No active calls")}`);
}

function handleUnmute(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (call) { call.unmute(); log(`${OK("✓")} Mic unmuted`); }
    else log(`${WARN("No active calls")}`);
}

function handleCalls(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;
    const active = getActiveCalls();
    if (active.size === 0) {
        log(`${DIM("No active calls")}`);
        return;
    }
    const selected = getSelectedCall();
    for (const entry of active.values()) {
        const c = entry.call;
        const sel = c.id === selected?.id ? OK("▸") : " ";
        const dir = c.direction === "inbound" ? "←" : "→";
        const elapsed = ((Date.now() - entry.startTime) / 1000).toFixed(0) + "s";
        log(`${sel} ${DIM(`[${entry.index}]`)} ${dir} ${c.from} → ${c.to} ${MUTED(elapsed)} ${DIM(c.id.slice(0, 12))}`);
    }
}

function handleSwitch(ctx: CommandContext, args: string[]): void {
    const log = ctx.log ?? logLine;
    const target = args[0];
    if (!target) {
        log(`${WARN("Usage:")} /switch <number|call-id-prefix>`);
        return;
    }
    const call = selectCall(target);
    if (call) {
        log(`${OK("✓")} Selected call ${getCallLabel(call)} ${DIM(call.id.slice(0, 12))}`);
    } else {
        log(`${ERR("Not found:")} no call matching "${target}"`);
    }
}

function handleConfig(ctx: CommandContext, args: string[]): void {
    const log = ctx.log ?? logLine;
    const call = resolveCall(ctx);
    if (!call) {
        log(`${WARN("No active call")} — start a call first`);
        return;
    }

    const [sub, ...rest] = args;
    const value = rest.join(" ");

    if (!sub) {
        log(`${DIM("Usage:")} /config voice|stt|turn|lang <value>`);
        log(`  ${MUTED("/config voice")} elevenlabs:abc123`);
        log(`  ${MUTED("/config stt")}   deepgram:nova-3:es`);
        log(`  ${MUTED("/config turn")}  smart_turn [silenceMs]`);
        log(`  ${MUTED("/config lang")}  fr`);
        return;
    }

    switch (sub) {
        case "voice":
        case "tts":
            if (!value) { log(`${WARN("Usage:")} /config voice <voice-id>`); return; }
            call.configure({ voice: value });
            log(`${OK("✓")} Voice → ${value}`);
            break;

        case "stt":
            if (!value) { log(`${WARN("Usage:")} /config stt <provider:model>`); return; }
            call.configure({ stt: value });
            log(`${OK("✓")} STT → ${value}`);
            break;

        case "turn":
            if (!value) { log(`${WARN("Usage:")} /config turn <mode> [silenceMs]`); return; }
            const [mode, silenceStr] = value.split(" ");
            const turnConfig = silenceStr
                ? { mode, silenceMs: parseInt(silenceStr, 10) }
                : mode;
            call.configure({ turnDetection: turnConfig });
            log(`${OK("✓")} Turn detection → ${value}`);
            break;

        case "lang":
        case "language":
            if (!value) { log(`${WARN("Usage:")} /config lang <code>`); return; }
            call.configure({ language: value });
            log(`${OK("✓")} Language → ${value}`);
            break;

        default:
            log(`${ERR("Unknown config:")} ${sub}. Options: voice, stt, turn, lang`);
    }
}

// ── /dial command ────────────────────────────────────────────────────────

function handleDial(ctx: CommandContext, args: string[]): void {
    const log = ctx.log ?? logLine;

    if (args.length === 0) {
        log(`${DIM("Usage:")} /dial [agent] +number ["greeting"]`);
        log(`  ${MUTED("/dial")} +1234567890`);
        log(`  ${MUTED("/dial")} sales +1234567890`);
        log(`  ${MUTED('/dial')} sales +1234567890 "Hello, this is support."`);
        if (ctx.agents && ctx.agents.size > 0) {
            log(`${DIM("Agents:")} ${[...ctx.agents.keys()].join(", ")}`);
        }
        return;
    }

    // Parse: /dial [agent] +number ["greeting"]
    let targetAgent: Agent | null = null;
    let number: string | null = null;
    let greeting: string | undefined;

    // Join args back and extract quoted greeting
    const full = args.join(" ");
    const quoteMatch = full.match(/"([^"]+)"/);
    if (quoteMatch) greeting = quoteMatch[1];

    // Remove quoted part for simpler parsing
    const withoutQuote = full.replace(/"[^"]*"/, "").trim().split(/\s+/);

    if (withoutQuote.length === 1) {
        // /dial +number
        number = withoutQuote[0];
        targetAgent = ctx.agent;
    } else if (withoutQuote.length >= 2) {
        // /dial agent +number
        const agentName = withoutQuote[0];
        number = withoutQuote[1];

        // Find agent by name
        if (ctx.agents) {
            targetAgent = ctx.agents.get(agentName) ?? null;
            if (!targetAgent) {
                // Fuzzy: try case-insensitive prefix
                const lower = agentName.toLowerCase();
                for (const [key, a] of ctx.agents) {
                    if (key.toLowerCase().startsWith(lower) || a.id.toLowerCase().startsWith(lower)) {
                        targetAgent = a;
                        break;
                    }
                }
            }
        }
        if (!targetAgent) targetAgent = ctx.agent;
    }

    if (!number || !number.startsWith("+")) {
        log(`${ERR("Invalid number:")} must start with + (e.g. +1234567890)`);
        return;
    }

    if (!targetAgent) {
        log(`${ERR("No agent found")}`);
        return;
    }

    // Find a "from" number on this agent
    const channels = targetAgent.channels;
    let from: string | null = null;
    if (channels) {
        for (const [ref, config] of channels) {
            if (ref.startsWith("+")) { from = ref; break; }
        }
    }

    if (!from) {
        log(`${ERR("No phone number")} on agent ${targetAgent.id} — can't dial`);
        return;
    }

    log(`${OK("⤴")} Dialing ${ACCENT(number)} from ${DIM(from)}${greeting ? ` ${DIM(`"${greeting}"`)}` : ""}`);
    targetAgent.dial({ to: number, from, greeting });
}

// ── /phones command ─────────────────────────────────────────────────────

async function handlePhones(ctx: CommandContext): Promise<void> {
    const log = ctx.log ?? logLine;

    if (!ctx.pc) {
        log(`${ERR("No Pinecall client available")}`);
        return;
    }

    log(`${DIM("Fetching phones...")}`);

    try {
        const phones = await ctx.pc.fetchPhones();

        if (phones.length === 0) {
            log(`${DIM("No phone numbers found")}`);
            log(`  ${DIM("Add one at")} ${ACCENT("https://app.pinecall.io/phones")}`);
            return;
        }

        log(`${MUTED("Number".padEnd(20))} ${MUTED("Name".padEnd(24))} ${MUTED("SID")}`);
        log(`${MUTED("─".repeat(64))}`);
        for (const p of phones) {
            log(`${ACCENT((p.number ?? "").padEnd(20))} ${((p.name ?? "").padEnd(24))} ${DIM(p.sid ?? "")}`);
        }
        log(`${OK(`${phones.length} phone${phones.length === 1 ? "" : "s"}`)}`);
    } catch (err) {
        log(`${ERR("Failed to fetch phones:")} ${err}`);
    }
}

// ── /voices command ─────────────────────────────────────────────────────

async function handleVoices(ctx: CommandContext, args: string[]): Promise<void> {
    const log = ctx.log ?? logLine;
    const provider = args[0] ?? "elevenlabs";

    log(`${DIM(`Fetching ${provider} voices...`)}`);

    try {
        const voiceList = await fetchVoices({ provider });

        if (voiceList.length === 0) {
            log(`${DIM("No voices found")}`);
            return;
        }

        log(`${MUTED("ID".padEnd(32))} ${MUTED("Name".padEnd(24))} ${MUTED("Gender".padEnd(8))} ${MUTED("Languages")}`);
        log(`${MUTED("─".repeat(80))}`);
        for (const v of voiceList) {
            const langs = v.languages?.map((l: any) => l.code).join(", ") ?? "";
            const gender = v.gender ?? "";
            log(
                `${ACCENT(v.id.padEnd(32))} ` +
                `${v.name.padEnd(24)} ` +
                `${DIM(gender.padEnd(8))} ` +
                `${DIM(langs)}`
            );
        }
        log(`${OK(`${voiceList.length} voices`)} ${DIM(`(${provider})`)}`);
    } catch (err) {
        log(`${ERR("Failed to fetch voices:")} ${err}`);
    }
}

// ── /play command ───────────────────────────────────────────────────────

/** Cache voices across /play calls to avoid re-fetching. */
let _voiceCache: { provider: string; voices: any[] } | null = null;

async function handlePlay(ctx: CommandContext, args: string[]): Promise<void> {
    const log = ctx.log ?? logLine;
    const query = args.join(" ").trim();

    if (!query) {
        log(`${DIM("Usage: /play <voice name or ID> [provider]")}`);
        log(`  ${DIM("Examples: /play Sarah · /play adam · /play EXAVITQu4vr4xnSDxMaL")}`);
        return;
    }

    // Extract provider from last arg if it looks like one
    let provider = "elevenlabs";
    const knownProviders = ["elevenlabs", "cartesia", "deepgram"];
    const lastArg = args[args.length - 1]?.toLowerCase();
    const searchTerms = knownProviders.includes(lastArg)
        ? (provider = lastArg, args.slice(0, -1).join(" ").trim())
        : query;

    // Fetch voices (use cache if same provider)
    if (!_voiceCache || _voiceCache.provider !== provider) {
        log(`${DIM(`Fetching ${provider} voices...`)}`);
        try {
            const voiceList = await fetchVoices({ provider });
            _voiceCache = { provider, voices: voiceList };
        } catch (err) {
            log(`${ERR("Failed to fetch voices:")} ${err}`);
            return;
        }
    }

    const voices = _voiceCache.voices;
    const lower = (searchTerms || query).toLowerCase();

    // Fuzzy match: exact id → exact name → starts with → includes
    let match = voices.find((v: any) => v.id === query);
    if (!match) match = voices.find((v: any) => v.name.toLowerCase() === lower);
    if (!match) match = voices.find((v: any) => v.name.toLowerCase().startsWith(lower));
    if (!match) match = voices.find((v: any) => v.name.toLowerCase().includes(lower));
    if (!match) match = voices.find((v: any) => v.id.toLowerCase().startsWith(lower));

    if (!match) {
        log(`${ERR("No voice found matching:")} ${query}`);
        log(`  ${DIM("Try /voices to see available voices")}`);
        return;
    }

    if (!match.preview_url) {
        log(`${WARN("No preview available for")} ${ACCENT(match.name)} ${DIM(`(${match.id})`)}`);
        return;
    }

    log(`${DIM("▶")} Playing ${ACCENT(match.name)} ${DIM(`(${match.id})`)}  ${DIM("Ctrl+C to stop")}`);
    if (match.gender) log(`  ${DIM("Gender:")} ${match.gender}`);
    if (match.description) log(`  ${DIM(match.description.slice(0, 80))}`);

    // Download and play (non-blocking so Ctrl+C can cancel)
    try {
        const { spawn } = await import("node:child_process");
        const { writeFileSync, unlinkSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const path = await import("node:path");

        const tmpFile = path.join(tmpdir(), `pinecall-preview-${Date.now()}.mp3`);

        const response = await fetch(match.preview_url);
        if (!response.ok) {
            log(`${ERR("Failed to download preview:")} HTTP ${response.status}`);
            return;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(tmpFile, buffer);

        // Play with spawn — Ctrl+C kills child, not the CLI
        const player = spawn("afplay", [tmpFile], { stdio: "ignore" });

        const cleanup = () => {
            player.kill();
            try { unlinkSync(tmpFile); } catch { /* ignore */ }
        };

        // Ctrl+C → kill player only
        const onSigint = () => {
            cleanup();
            log(`  ${DIM("■ Stopped")}`);
        };
        process.once("SIGINT", onSigint);

        await new Promise<void>((resolve) => {
            player.on("close", () => resolve());
            player.on("error", () => {
                // afplay not found, try aplay
                const fallback = spawn("aplay", [tmpFile], { stdio: "ignore" });
                process.removeListener("SIGINT", onSigint);
                const onSigint2 = () => {
                    fallback.kill();
                    try { unlinkSync(tmpFile); } catch { /* ignore */ }
                    log(`  ${DIM("■ Stopped")}`);
                };
                process.once("SIGINT", onSigint2);
                fallback.on("close", () => {
                    process.removeListener("SIGINT", onSigint2);
                    resolve();
                });
                fallback.on("error", () => {
                    process.removeListener("SIGINT", onSigint2);
                    log(`${WARN("Could not play audio. Preview URL:")}`);
                    log(`  ${DIM(match.preview_url)}`);
                    resolve();
                });
            });
        });

        process.removeListener("SIGINT", onSigint);
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
        log(`${OK("✓")} Done`);
    } catch (err) {
        log(`${ERR("Playback error:")} ${err}`);
    }
}

// ── Command registry ─────────────────────────────────────────────────────

const commands: Record<string, CommandDef> = {
    "/help":    { description: "Show available commands", handler: handleHelp },
    "/phones":  { description: "List phone numbers", handler: handlePhones },
    "/voices":  { description: "List TTS voices", usage: "[provider]", handler: handleVoices },
    "/play":    { description: "Play voice preview", usage: "<name|id> [provider]", handler: handlePlay },
    "/calls":   { description: "List active calls", handler: handleCalls },
    "/switch":  { description: "Select active call", usage: "<1|sid>", handler: handleSwitch },
    "/config":  { description: "Change call config", usage: "<voice|stt|turn|lang> <val>", handler: handleConfig },
    "/dial":    { description: "Outbound call", usage: "[agent] +number [\"greeting\"]", handler: handleDial },
    "/hangup":  { description: "Hang up selected call (or all)", handler: handleHangup },
    "/hold":    { description: "Put selected call on hold", handler: handleHold },
    "/unhold":  { description: "Resume held call", handler: handleUnhold },
    "/mute":    { description: "Mute the microphone", handler: handleMute },
    "/unmute":  { description: "Unmute the microphone", handler: handleUnmute },
    "/history": { description: "Show raw LLM history (JSON)", handler: handleHistory },
};

/**
 * Dispatch a slash command.
 * Returns true if the command was handled, false if unknown.
 */
export function handleCommand(input: string, ctx: CommandContext): boolean {
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    const log = ctx.log ?? logLine;
    const def = commands[cmd];
    if (!def) {
        if (cmd.startsWith("/")) {
            log(`${ERR("Unknown command:")} ${cmd}. Type /help for available commands.`);
            return true;
        }
        return false;
    }
    def.handler(ctx, args);
    return true;
}

// ── /history command ─────────────────────────────────────────────────────

import chalk from "chalk";

/** Syntax-highlight a JSON string with chalk colors. */
function highlightJson(json: string): string {
    return json
        // Keys
        .replace(/"(\w+)"\s*:/g, (_, key) => `${chalk.hex("#9d4edd")(`"${key}"`)}:`)
        // String values (after colon)
        .replace(/:\s*"([^"]*)"/g, (_, val) => `: ${chalk.hex("#22C55E")(`"${val}"`)}`)  
        // Numbers
        .replace(/:\s*(\d+\.?\d*)/g, (_, num) => `: ${chalk.hex("#F59E0B")(num)}`)
        // Booleans / null
        .replace(/:\s*(true|false|null)/g, (_, val) => `: ${chalk.hex("#06B6D4")(val)}`);
}

function handleHistory(ctx: CommandContext): void {
    const log = ctx.log ?? logLine;

    // Find a call to get history for
    const call = resolveCall(ctx) ?? [...ctx.agent.calls.values()][0];
    if (!call && !ctx.getHistory) {
        log(`${DIM("No active calls and no history available")}`);
        return;
    }

    const callId = call?.id;
    let messages: unknown[] | undefined;

    if (ctx.getHistory && callId) {
        messages = ctx.getHistory(callId);
    }

    if (!messages || messages.length === 0) {
        log(`${DIM("No history for ${callId ? callId.slice(0, 12) : 'any call'}")}`);
        return;
    }

    log(`${MUTED(`─── History (${messages.length} messages) ───`)}`);

    for (const msg of messages) {
        const raw = JSON.stringify(msg, null, 2);
        const highlighted = highlightJson(raw);
        for (const line of highlighted.split("\n")) {
            log(`  ${line}`);
        }
        log(""); // spacing between messages
    }

    log(`${MUTED(`─── End (${messages.length} messages) ───`)}`);
}
