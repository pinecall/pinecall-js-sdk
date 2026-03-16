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
    /** Original AI agent instance (has channels, voice, etc). */
    sourceAgent?: any;
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

    // Download and play
    try {
        const { spawn } = await import("node:child_process");
        const { writeFileSync, unlinkSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const path = await import("node:path");
        const { setPlayingProcess, clearPlayingProcess } = await import("./input.js");

        const tmpFile = path.join(tmpdir(), `pinecall-preview-${Date.now()}.mp3`);

        const response = await fetch(match.preview_url);
        if (!response.ok) {
            log(`${ERR("Failed to download preview:")} HTTP ${response.status}`);
            return;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(tmpFile, buffer);

        const doCleanup = () => {
            try { unlinkSync(tmpFile); } catch { /* ignore */ }
            log(`  ${DIM("■ Stopped")}`);
        };

        // Spawn player detached so we fully control its lifecycle
        const player = spawn("afplay", [tmpFile], { stdio: "ignore" });

        // Register with input.ts — Ctrl+C will kill this process
        setPlayingProcess(player, doCleanup);

        const stopped = await new Promise<boolean>((resolve) => {
            player.on("close", (code) => {
                // code null = killed by signal (Ctrl+C), 0 = natural end
                resolve(code !== 0 && code !== null);
            });
            player.on("error", () => {
                // afplay not found — try aplay
                const fallback = spawn("aplay", [tmpFile], { stdio: "ignore" });
                setPlayingProcess(fallback, doCleanup);
                fallback.on("close", (code) => resolve(code !== 0 && code !== null));
                fallback.on("error", () => {
                    log(`${WARN("Could not play audio. Preview URL:")}`);
                    log(`  ${DIM(match.preview_url)}`);
                    resolve(false);
                });
            });
        });

        clearPlayingProcess();
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
        if (!stopped) log(`${OK("✓")} Done`);
    } catch (err) {
        log(`${ERR("Playback error:")} ${err}`);
    }
}

// ── Command registry ─────────────────────────────────────────────────────

// ── /webrtc command ─────────────────────────────────────────────────────

let _webrtcServer: import("node:http").Server | null = null;

async function handleWebRTC(ctx: CommandContext, args: string[]): Promise<void> {
    const log = ctx.log ?? logLine;

    if (_webrtcServer) {
        log(`${WARN("WebRTC browser already running. Close the browser tab first.")}`);
        return;
    }

    // Resolve app_id from agent
    const appId = ctx.agent.id ?? args[0];
    if (!appId) {
        log(`${ERR("Cannot determine app_id. Pass it as argument:")} /webrtc my-agent`);
        return;
    }


    const http = await import("node:http");
    const { exec } = await import("node:child_process");

    // Extract language presets from agent channels
    // Build phone language presets first, then prepend "default" so it's selected initially
    const phoneLangs: Record<string, Record<string, unknown>> = {};
    const agentAny = (ctx.sourceAgent || ctx.agent) as any;
    const allCh = [...(agentAny.channels || []), ...(agentAny.phone ? [agentAny.phone] : [])];
    for (const ch of allCh) {
        if (ch?.type === "phone" && ch.language) {
            const lang = ch.language;
            if (!phoneLangs[lang]) {
                const p: Record<string, unknown> = { label: lang.toUpperCase(), language: lang };
                if (ch.voice) p.voice = ch.voice;
                if (ch.stt) p.stt = ch.stt;
                if (ch.turnDetection) p.turnDetection = ch.turnDetection;
                if (typeof ch.greeting === "string" && ch.greeting) p.greeting = ch.greeting;
                phoneLangs[lang] = p;
            }
        }
    }
    // "default" first so the <select> starts with EN (WebRTC default)
    const langPresets: Record<string, Record<string, unknown>> = {};
    if (Object.keys(phoneLangs).length > 0) {
        const def: Record<string, unknown> = { label: "EN (Default)", language: agentAny.language || "en" };
        if (agentAny.voice) def.voice = agentAny.voice;
        langPresets["default"] = def;
        Object.assign(langPresets, phoneLangs);
    }

    const html = generateWebRTCPage(appId, langPresets);

    // Read the IIFE bundle once
    const { readFileSync, existsSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __here = dirname(fileURLToPath(import.meta.url));
    // Try sibling (compiled in dist/) first, then relative from source
    const candidates = [
        join(__here, "pinecall-webrtc.iife.global.js"),
        join(__here, "..", "dist", "pinecall-webrtc.iife.global.js"),
        join(__here, "..", "..", "dist", "pinecall-webrtc.iife.global.js"),
    ];
    const bundlePath = candidates.find(p => existsSync(p)) ?? null;
    const bundleContent = bundlePath ? readFileSync(bundlePath, "utf-8") : null;

    // Get API key and server URL from the Pinecall client
    const apiKey = (ctx.pc as any)?._opts?.apiKey;
    const wsUrl = (ctx.pc as any)?._opts?.url ?? "wss://voice.pinecall.io/client";
    const voiceServerUrl = wsUrl
        .replace(/\/client\/?$/, "")
        .replace(/^wss:\/\//, "https://")
        .replace(/^ws:\/\//, "http://");

    const server = http.createServer(async (req, res) => {
        const url = req.url ?? "/";
        const json = (status: number, data: unknown) => {
            res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
            res.end(JSON.stringify(data));
        };

        // Serve the bundle at /pinecall-webrtc.js
        if (url === "/pinecall-webrtc.js") {
            if (!bundleContent) {
                res.writeHead(404, { "Content-Type": "text/plain" });
                res.end("WebRTC bundle not found. Run 'npm run build'.");
                return;
            }
            res.writeHead(200, {
                "Content-Type": "application/javascript",
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
            });
            res.end(bundleContent);
            return;
        }

        // GET /server-info — return voice server URL + agent IDs
        if (url === "/server-info") {
            json(200, { pinecallServer: voiceServerUrl, appIds: [appId] });
            return;
        }

        // GET /webrtc/token?agent_id=xxx — fetch token using API key
        if (url.startsWith("/webrtc/token")) {
            const urlObj = new URL(url, `http://localhost`);
            const agentId = urlObj.searchParams.get("agent_id");
            if (!agentId) { json(400, { error: "Missing agent_id" }); return; }
            if (!apiKey) { json(500, { error: "No API key. Set PINECALL_API_KEY." }); return; }

            try {
                const { fetchWebRTCToken } = await import("@pinecall/sdk");
                const tokenData = await fetchWebRTCToken({ apiKey, agentId });
                json(200, { ...tokenData, server: tokenData.server ?? voiceServerUrl });
            } catch (err) {
                json(500, { error: `Token fetch failed: ${err}` });
            }
            return;
        }

        // Everything else serves the HTML
        res.writeHead(200, { "Content-Type": "text/html", "Access-Control-Allow-Origin": "*" });
        res.end(html);
    });

    const port = 9876;
    server.listen(port, () => {
        log(`${OK("✓")} WebRTC page at ${ACCENT(`http://localhost:${port}`)}`);
        log(`${DIM("Opening browser…")}`);
        const url = `http://localhost:${port}`;
        const cmd = process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "${url}"` : `xdg-open "${url}"`;
        exec(cmd);
    });

    _webrtcServer = server;

    // Auto-close when server process exits
    process.on("exit", () => { server.close(); });
}

function generateWebRTCPage(appId: string, langPresets: Record<string, Record<string, unknown>> = {}): string {
    const hasLangs = Object.keys(langPresets).length > 1;
    const langsJSON = JSON.stringify(langPresets);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pinecall WebRTC — ${appId}</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
  body { font-family: 'Inter', sans-serif; }
  .scrollbar-thin { scrollbar-width: thin; scrollbar-color: rgba(80,80,120,0.3) transparent; }
  .scrollbar-thin::-webkit-scrollbar { width: 4px; }
  .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(80,80,120,0.3); border-radius: 2px; }
  @keyframes fade-up { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
  @keyframes pulse-ring { 0% { transform:scale(1); opacity:0.5 } 100% { transform:scale(2.2); opacity:0 } }
  .animate-fade-up { animation: fade-up 0.25s ease-out; }
  .glass { background: rgba(255,255,255,0.03); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.06); }
</style>
</head>
<body class="bg-[#0b0b18] text-white min-h-screen flex flex-col">
  <header class="flex items-center justify-between px-8 py-5">
    <div class="flex items-center gap-3">
      <div class="w-2 h-2 rounded-full bg-emerald-400"></div>
      <span class="text-sm text-gray-400 tracking-wide">Pinecall WebRTC</span>
    </div>
    <div class="flex items-center gap-4">
      <span id="duration" class="text-xs font-mono text-gray-500 hidden tabular-nums">0:00</span>
      <button id="eventsToggle" onclick="toggleEvents()"
        class="text-xs px-3 py-1.5 rounded-lg glass text-gray-400 hover:text-white transition cursor-pointer">
        Events <span id="eventCount" class="text-gray-600">(0)</span>
      </button>
    </div>
  </header>
  <div class="flex-1 flex overflow-hidden">
    <div class="flex-1 flex flex-col px-8 pb-6">
      <div id="waveformContainer" class="mb-4 hidden">
        <div class="glass rounded-xl px-5 py-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[10px] uppercase tracking-widest text-gray-500">Audio</span>
            <span id="waveLabel" class="text-[10px] tracking-wide text-gray-600 transition-colors">Idle</span>
          </div>
          <canvas id="waveCanvas" class="w-full rounded" style="height:44px"></canvas>
        </div>
      </div>
      <div id="chat" class="flex-1 overflow-y-auto space-y-4 scrollbar-thin pr-2">
        <div id="emptyState" class="flex flex-col items-center justify-center h-full gap-6">
          <div class="w-16 h-16 rounded-2xl glass flex items-center justify-center">
            <svg class="w-7 h-7 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div class="text-center">
            <p class="text-gray-400 text-sm">Press to start a conversation</p>
            <p class="text-gray-600 text-xs mt-1">Agent: <span class="text-gray-500">${appId}</span></p>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-center gap-4 pt-6">${hasLangs ? `
        <select id="langSelect" onchange="switchLang(this.value)" class="text-xs py-2 px-3 rounded-lg glass text-gray-300 cursor-pointer outline-none" style="min-width:90px">
          ${Object.entries(langPresets).map(([k, v]) => `<option value="${k}" style="background:#0b0b18">${(v.label as string) || k}</option>`).join('')}
        </select>` : ''}
        <button id="muteBtn" onclick="doMute()" class="hidden w-12 h-12 rounded-full glass text-lg hover:bg-white/5 transition cursor-pointer">🎙️</button>
        <div class="relative">
          <button id="callBtn" onclick="toggleCall()"
            class="relative z-10 w-16 h-16 rounded-full bg-emerald-500 text-white text-xl shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </button>
          <div id="callRing" class="hidden absolute inset-0 rounded-full border-2 border-emerald-400" style="animation: pulse-ring 1.5s ease-out infinite"></div>
        </div>
      </div>
      <p id="status" class="text-center text-[11px] text-gray-600 mt-3">Ready</p>
    </div>
    <aside id="eventsPanel" class="hidden w-80 border-l border-white/5 flex flex-col bg-[#0d0d1a]">
      <div class="flex items-center justify-between px-5 py-4 border-b border-white/5">
        <span class="text-[10px] uppercase tracking-widest text-gray-500">Data Channel Events</span>
        <button onclick="clearEvents()" class="text-gray-600 hover:text-gray-400 text-xs cursor-pointer">Clear</button>
      </div>
      <div id="eventsList" class="flex-1 overflow-y-auto scrollbar-thin"></div>
    </aside>
  </div>

<script src="/pinecall-webrtc.js"><\/script>
<script>
const AGENT_ID = "${appId}";
const { PinecallWebRTC } = Pinecall;
let webrtc = null, events = [], durationTimer = null, callStart = 0, botMessages = {};
const LANG_PRESETS = ${langsJSON};
let selectedConfig = null; // Pre-call language config
function switchLang(key) {
  const p = LANG_PRESETS[key]; if (!p) return;
  const cfg = {};
  if (p.voice) cfg.voice = p.voice;
  if (p.stt) cfg.stt = p.stt;
  if (p.language) cfg.language = p.language;
  if (p.turnDetection) cfg.turnDetection = p.turnDetection;
  if (p.greeting) cfg.greeting = p.greeting;
  if (webrtc) {
    // Mid-call: send configure action
    if (Object.keys(cfg).length > 0) {
      webrtc.send({ action: 'configure', ...cfg });
      addMsg('system', 'Language → ' + (p.label || key));
      addEvent({event:'configure', ...cfg});
    }
  } else {
    // Pre-call: store for next connect
    selectedConfig = (key === 'default') ? null : cfg;
    status.textContent = 'Ready — ' + (p.label || key);
  }
}
let audioCtx = null, waveAnimFrame = null;
let userAnalyser = null, agentAnalyser = null;
let userHistory = new Array(80).fill(0), agentHistory = new Array(80).fill(0);

const micSVG = '<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>';
const xSVG = '<svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>';
const greenBtn = 'relative z-10 w-16 h-16 rounded-full bg-emerald-500 text-white text-xl shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center';
const redBtn = 'relative z-10 w-16 h-16 rounded-full bg-red-500 text-white text-xl shadow-lg shadow-red-500/20 hover:bg-red-400 hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center';

function startWaveform(local, remote) {
  audioCtx = new AudioContext();
  if (local) { const s = audioCtx.createMediaStreamSource(local); userAnalyser = audioCtx.createAnalyser(); userAnalyser.fftSize=256; s.connect(userAnalyser); }
  if (remote) { const s = audioCtx.createMediaStreamSource(remote); agentAnalyser = audioCtx.createAnalyser(); agentAnalyser.fftSize=256; s.connect(agentAnalyser); }
  waveformContainer.classList.remove('hidden');
  drawWave();
}
function addRemoteStream(rs) {
  if (!audioCtx || !rs) return;
  try { const s = audioCtx.createMediaStreamSource(rs); agentAnalyser = audioCtx.createAnalyser(); agentAnalyser.fftSize=256; s.connect(agentAnalyser); } catch {}
}
function stopWaveform() {
  if (waveAnimFrame) cancelAnimationFrame(waveAnimFrame);
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  userAnalyser = agentAnalyser = null;
  userHistory = new Array(80).fill(0); agentHistory = new Array(80).fill(0);
  waveformContainer.classList.add('hidden');
}
function getRms(a) { if (!a) return 0; const d = new Uint8Array(a.frequencyBinCount); a.getByteTimeDomainData(d); let s=0; for (let i=0;i<d.length;i++){const v=(d[i]-128)/128;s+=v*v;} return Math.sqrt(s/d.length); }
function drawWave() {
  const c = waveCanvas, ctx = c.getContext('2d'), dpr = devicePixelRatio||1, w = c.clientWidth, h = c.clientHeight;
  c.width=w*dpr; c.height=h*dpr; ctx.scale(dpr,dpr); ctx.clearRect(0,0,w,h);
  const uR=getRms(userAnalyser), aR=getRms(agentAnalyser);
  userHistory.push(Math.min(1,uR*5)); agentHistory.push(Math.min(1,aR*5));
  if(userHistory.length>80) userHistory.shift(); if(agentHistory.length>80) agentHistory.shift();
  if(uR>0.02){waveLabel.textContent='You';waveLabel.style.color='#4ade80';}
  else if(aR>0.01){waveLabel.textContent='Agent';waveLabel.style.color='#a78bfa';}
  else{waveLabel.textContent='Listening';waveLabel.style.color='#6b7280';}
  const mid=h/2,bW=2.5,gap=1.5,total=Math.min(80,Math.floor(w/(bW+gap))),sx=(w-total*(bW+gap)+gap)/2;
  for(let i=0;i<total;i++){
    const idx=80-total+i, uI=userHistory[idx]||0, aI=agentHistory[idx]||0, intensity=Math.max(uI,aI), isA=aI>uI;
    const bH=Math.max(1,intensity*h*0.4);
    if(intensity>0.01){const g=ctx.createLinearGradient(0,mid-bH,0,mid+bH);
      if(isA){g.addColorStop(0,'rgba(167,139,250,0.05)');g.addColorStop(0.5,'rgba(167,139,250,'+(0.3+intensity*0.7)+')');g.addColorStop(1,'rgba(167,139,250,0.05)');}
      else{g.addColorStop(0,'rgba(74,222,128,0.05)');g.addColorStop(0.5,'rgba(74,222,128,'+(0.3+intensity*0.7)+')');g.addColorStop(1,'rgba(74,222,128,0.05)');}
      ctx.fillStyle=g;
    }else{ctx.fillStyle='rgba(255,255,255,0.03)';}
    ctx.beginPath();ctx.roundRect(sx+i*(bW+gap),mid-bH,bW,bH*2,1);ctx.fill();
  }
  waveAnimFrame = requestAnimationFrame(drawWave);
}

function addMsg(role, text, opts={}) {
  const e = document.getElementById('emptyState'); if(e) e.remove();
  const d = document.createElement('div');
  d.className = (role==='user'?'flex justify-end':role==='system'?'flex justify-center':'flex justify-start')+' animate-fade-up';
  const b = document.createElement('div');
  if(role==='system') b.className='px-4 py-2 rounded-full glass text-xs text-gray-400';
  else if(role==='user') b.className='max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed '+(opts.interim?'glass opacity-50':'bg-emerald-500/10 border border-emerald-500/15 text-emerald-100');
  else b.className='max-w-[75%] px-4 py-3 rounded-2xl glass text-sm text-gray-200 leading-relaxed';
  b.textContent=text; if(opts.id) b.id=opts.id;
  d.appendChild(b); chat.appendChild(d); chat.scrollTop=chat.scrollHeight; return b;
}
function updateMsg(id, text, opts={}) {
  const el = document.getElementById(id); if(!el) return;
  if(text) el.textContent=text;
  if(opts.interrupted){el.classList.add('opacity-30');el.style.textDecoration='line-through';}
  if(opts.done) el.classList.remove('animate-pulse');
}

function addEvent(evt) {
  events.push(evt); eventCount.textContent='('+events.length+')';
  const el = document.createElement('div');
  el.className='px-5 py-3 border-b border-white/[.03] cursor-pointer hover:bg-white/[.02] transition';
  const dot = evt.event?.startsWith('user')?'#4ade80':evt.event?.startsWith('bot')?'#a78bfa':'#60a5fa';
  el.innerHTML='<div class="flex items-center gap-2"><div class="w-1.5 h-1.5 rounded-full flex-shrink-0" style="background:'+dot+'"></div><span class="text-xs font-mono text-gray-400 truncate">'+evt.event+'</span></div>';
  el.onclick=()=>{const p=el.querySelector('pre');if(p){p.remove();return;}const pr=document.createElement('pre');pr.className='mt-2 text-[10px] p-3 rounded-lg bg-black/30 text-gray-500 overflow-auto max-h-40';pr.style.whiteSpace='pre-wrap';pr.style.wordBreak='break-all';pr.textContent=JSON.stringify(evt,null,2);el.appendChild(pr);};
  eventsList.appendChild(el); eventsList.scrollTop=eventsList.scrollHeight;
}
function clearEvents(){events=[];eventsList.innerHTML='';eventCount.textContent='(0)';}
function toggleEvents(){eventsPanel.classList.toggle('hidden');eventsPanel.classList.toggle('flex');}

function startDuration(){callStart=Date.now();duration.classList.remove('hidden');durationTimer=setInterval(()=>{const s=Math.floor((Date.now()-callStart)/1000);duration.textContent=Math.floor(s/60)+':'+(s%60).toString().padStart(2,'0');},1000);}
function stopDuration(){if(durationTimer){clearInterval(durationTimer);durationTimer=null;}}
function doMute(){if(!webrtc)return;webrtc.toggleMute();muteBtn.textContent=webrtc.isMuted?'🔇':'🎙️';}

async function toggleCall() {
  if (webrtc) {
    webrtc.disconnect(); webrtc=null; stopDuration(); stopWaveform();
    callBtn.innerHTML=micSVG; callBtn.className=greenBtn; callRing.classList.add('hidden');
    muteBtn.classList.add('hidden'); status.textContent='Disconnected'; return;
  }
  status.textContent='Connecting…'; callRing.classList.remove('hidden'); botMessages={};
  try {
    const opts = selectedConfig ? { config: selectedConfig } : {};
    webrtc = new PinecallWebRTC(AGENT_ID, opts);
    webrtc.on('connected', () => {
      status.textContent='Connected'; callBtn.innerHTML=xSVG; callBtn.className=redBtn;
      callRing.classList.add('hidden'); muteBtn.classList.remove('hidden');
      chat.innerHTML=''; addMsg('system','Connected — start talking'); startDuration();
      if(webrtc.localStream) startWaveform(webrtc.localStream, webrtc.remoteStream);
      if(!webrtc.remoteStream){const ck=setInterval(()=>{if(!webrtc){clearInterval(ck);return;}if(webrtc.remoteStream){addRemoteStream(webrtc.remoteStream);clearInterval(ck);}},200);}
    });
    webrtc.on('disconnected', () => {
      status.textContent='Disconnected'; stopDuration(); stopWaveform();
      callBtn.innerHTML=micSVG; callBtn.className=greenBtn; callRing.classList.add('hidden');
      muteBtn.classList.add('hidden'); webrtc=null;
    });
    webrtc.on('session.started',(d)=>{addMsg('system','Session started');addEvent({event:'session.started',...d});});
    let interimEl = null;
    webrtc.on('user.speaking',(d)=>{if(!interimEl)interimEl=addMsg('user',d.text,{interim:true});else interimEl.textContent=d.text;addEvent({event:'user.speaking',text:d.text});});
    webrtc.on('user.message',(d)=>{if(interimEl){interimEl.textContent=d.text;interimEl.className='max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed bg-emerald-500/10 border border-emerald-500/15 text-emerald-100';interimEl=null;}else addMsg('user',d.text);addEvent({event:'user.message',text:d.text});});
    webrtc.on('bot.speaking',(d)=>{const id='bot-'+d.message_id;const el=addMsg('bot',d.text||'…',{id});el.classList.add('animate-pulse');botMessages[d.message_id]={words:[],el:id};addEvent({event:'bot.speaking',message_id:d.message_id});});
    webrtc.on('bot.word',(d)=>{const e=botMessages[d.message_id];if(e){e.words[d.word_index??e.words.length]=d.word;updateMsg(e.el,e.words.filter(Boolean).join(' '));}});
    webrtc.on('bot.finished',(d)=>{const e=botMessages[d.message_id];if(e){if(d.text)updateMsg(e.el,d.text);updateMsg(e.el,null,{done:true});}addEvent({event:'bot.finished',message_id:d.message_id});});
    webrtc.on('bot.interrupted',(d)=>{const e=botMessages[d.message_id];if(e)updateMsg(e.el,null,{interrupted:true,done:true});addEvent({event:'bot.interrupted',message_id:d.message_id});});
    webrtc.on('turn.end',(d)=>addEvent({event:'turn.end',...d}));
    await webrtc.connect();
  } catch(e) { status.textContent='Error: '+e.message; callRing.classList.add('hidden'); webrtc=null; }
}
<\/script>
</body>
</html>`;
}


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
    "/webrtc":  { description: "Open WebRTC call in browser", handler: handleWebRTC },
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
