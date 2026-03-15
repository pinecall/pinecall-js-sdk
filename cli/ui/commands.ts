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
    const appId = (ctx.agent as any)._appId ?? (ctx.agent as any).appId ?? args[0];
    if (!appId) {
        log(`${ERR("Cannot determine app_id. Pass it as argument:")} /webrtc my-agent`);
        return;
    }

    // Resolve server URL
    const serverUrl = (ctx.pc as any)?._url ?? (ctx.pc as any)?.url ?? "http://localhost:8765";
    const httpUrl = serverUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");

    const http = await import("node:http");
    const { exec } = await import("node:child_process");

    const html = generateWebRTCPage(httpUrl, appId);

    const server = http.createServer((req, res) => {
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

function generateWebRTCPage(serverUrl: string, appId: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pinecall WebRTC — ${appId}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: #0d0118;
    color: #eef0fa;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2rem;
  }
  h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 0.5rem; color: #c084fc; }
  .subtitle { font-size: 0.85rem; color: #7c6f99; margin-bottom: 2rem; }
  .card {
    background: rgba(30, 15, 50, 0.8);
    border: 1px solid rgba(120, 80, 180, 0.2);
    border-radius: 16px;
    padding: 2rem;
    width: 100%;
    max-width: 520px;
    backdrop-filter: blur(20px);
  }
  .status { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem; font-size: 0.9rem; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .dot.idle { background: #555; }
  .dot.connecting { background: #ffc43c; animation: pulse 1s infinite; }
  .dot.connected { background: #5cf598; }
  .dot.error { background: #ff6b6b; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  button {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 12px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    width: 100%;
  }
  button:hover { transform: scale(1.02); }
  button:active { transform: scale(0.98); }
  .btn-call { background: linear-gradient(135deg, #5cf598, #22c55e); color: #0d0118; }
  .btn-end { background: linear-gradient(135deg, #ff6b6b, #dc2626); color: white; }
  .btn-call:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
  .transcript {
    margin-top: 1.5rem;
    max-height: 300px;
    overflow-y: auto;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .msg { padding: 0.3rem 0; }
  .msg.user { color: #a78bfa; }
  .msg.bot { color: #5cf598; }
  .msg.system { color: #7c6f99; font-style: italic; }
  .msg .label { font-weight: 600; margin-right: 0.3rem; }
  .timer { font-family: 'SF Mono', monospace; color: #7c6f99; font-size: 0.8rem; }
</style>
</head>
<body>
<h1>🎙️ Pinecall WebRTC</h1>
<p class="subtitle">${appId} — ${serverUrl}</p>
<div class="card">
  <div class="status">
    <div class="dot" id="dot"></div>
    <span id="statusText">Ready</span>
    <span class="timer" id="timer" style="margin-left:auto"></span>
  </div>
  <button id="callBtn" class="btn-call" onclick="toggleCall()">Start Call</button>
  <div class="transcript" id="transcript"></div>
</div>
<script>
const SERVER = "${serverUrl}";
const APP_ID = "${appId}";
let pc = null, localStream = null, remoteAudio = null, connected = false;
let timerInterval = null, startTime = 0;

function $(id) { return document.getElementById(id); }
function setStatus(state, text) {
  $("dot").className = "dot " + state;
  $("statusText").textContent = text;
}
function addMsg(role, text) {
  const d = document.createElement("div");
  d.className = "msg " + role;
  d.innerHTML = '<span class="label">' + (role === "user" ? "You:" : role === "bot" ? "Bot:" : "•") + "</span>" + text;
  $("transcript").appendChild(d);
  $("transcript").scrollTop = $("transcript").scrollHeight;
}
function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    $("timer").textContent = Math.floor(s/60).toString().padStart(2,"0") + ":" + (s%60).toString().padStart(2,"0");
  }, 1000);
}
function stopTimer() { clearInterval(timerInterval); $("timer").textContent = ""; }

async function toggleCall() {
  if (connected) { disconnect(); return; }
  try {
    setStatus("connecting", "Connecting…");
    $("callBtn").disabled = true;

    // ICE servers
    let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    try { const r = await fetch(SERVER + "/webrtc/ice-servers"); if (r.ok) { const d = await r.json(); iceServers = d.iceServers || d.ice_servers || iceServers; } } catch {}

    // Mic
    localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });

    // Peer connection
    pc = new RTCPeerConnection({ iceServers });
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    // Remote audio
    pc.ontrack = e => {
      if (!remoteAudio) { remoteAudio = new Audio(); remoteAudio.autoplay = true; }
      remoteAudio.srcObject = e.streams[0];
    };

    // Data channel
    pc.ondatachannel = e => {
      const dc = e.channel;
      dc.onmessage = msg => {
        try {
          const data = JSON.parse(msg.data);
          switch (data.event) {
            case "session.started": addMsg("system", "Session started"); break;
            case "user.speaking": if (data.text) updateUser(data.text, true); break;
            case "user.message": if (data.text) updateUser(data.text, false); break;
            case "bot.speaking": if (data.text) addMsg("bot", data.text); break;
            case "bot.word": updateBot(data.message_id, data.word, data.word_index); break;
            case "bot.finished": break;
            case "bot.interrupted": addMsg("system", "Bot interrupted"); break;
            case "turn.end": break;
          }
        } catch {}
      };
      // Ping
      setInterval(() => { if (dc.readyState === "open") dc.send("ping"); }, 1000);
    };

    // Connection state
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        connected = true;
        setStatus("connected", "Connected");
        $("callBtn").disabled = false;
        $("callBtn").textContent = "End Call";
        $("callBtn").className = "btn-end";
        startTimer();
        addMsg("system", "Connected — start talking!");
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        disconnect();
      }
    };

    // Offer
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    await new Promise(r => { if (pc.iceGatheringState === "complete") r(); else { const t = setTimeout(r, 2000); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); r(); } }; } });

    const res = await fetch(SERVER + "/webrtc/offer?app_id=" + encodeURIComponent(APP_ID), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp: pc.localDescription.sdp, type: pc.localDescription.type }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed"); }
    const answer = await res.json();
    await pc.setRemoteDescription({ type: answer.type, sdp: answer.sdp });
  } catch (err) {
    setStatus("error", "Error: " + err.message);
    $("callBtn").disabled = false;
    disconnect();
  }
}

function disconnect() {
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (remoteAudio) { remoteAudio.pause(); remoteAudio.srcObject = null; remoteAudio = null; }
  connected = false;
  setStatus("idle", "Disconnected");
  stopTimer();
  $("callBtn").textContent = "Start Call";
  $("callBtn").className = "btn-call";
  $("callBtn").disabled = false;
}

// Live transcript helpers
let lastUserEl = null;
function updateUser(text, interim) {
  if (interim && lastUserEl) { lastUserEl.innerHTML = '<span class="label">You:</span>' + text; return; }
  lastUserEl = document.createElement("div");
  lastUserEl.className = "msg user";
  lastUserEl.innerHTML = '<span class="label">You:</span>' + text;
  $("transcript").appendChild(lastUserEl);
  if (!interim) lastUserEl = null;
  $("transcript").scrollTop = $("transcript").scrollHeight;
}

const botWords = {};
function updateBot(msgId, word, idx) {
  if (!botWords[msgId]) { botWords[msgId] = { el: null, words: [] }; }
  const b = botWords[msgId];
  if (!b.el) {
    b.el = document.createElement("div");
    b.el.className = "msg bot";
    b.el.innerHTML = '<span class="label">Bot:</span>';
    $("transcript").appendChild(b.el);
  }
  b.words[idx] = word;
  b.el.innerHTML = '<span class="label">Bot:</span>' + b.words.filter(Boolean).join(" ");
  $("transcript").scrollTop = $("transcript").scrollHeight;
}
</script>
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
