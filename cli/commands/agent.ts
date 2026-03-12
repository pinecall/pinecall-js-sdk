/**
 * pinecall agent — inbound voice agent command.
 *
 * Thin orchestrator: parse args → resolve env → build agent → TUI → connect.
 */

import { Pinecall } from "@pinecall/sdk";
import OpenAI from "openai";
import { parseArgs } from "../lib/args.js";
import { resolveEnv, requireOpenAI } from "../lib/env.js";
import { getPreset } from "../lib/presets.js";
import { DEFAULT_MODEL } from "../lib/constants.js";
import { pickPhone } from "../lib/phone-picker.js";
import { type LLMContext } from "../lib/llm.js";
import { streamLLMReplyWithTUI } from "../ui/tui-llm.js";
import { createTUI } from "../ui/tui.js";
import { createCallSidebar } from "../ui/tui-sidebar.js";
import { attachTUIEvents } from "../ui/tui-events.js";
import { setupCommandPalette } from "../ui/tui-commands.js";

export default async function agent(argv: string[]): Promise<void> {
    // ── Parse args ──
    const args = parseArgs(argv, {
        flags: ["--es"],
        values: ["--lang"],
    });

    const lang = args.values.get("--lang") ?? (args.flags.has("--es") ? "es" : "en");
    const preset = getPreset(lang);

    // ── Env ──
    const env = resolveEnv();
    requireOpenAI(env);
    const openai = new OpenAI({ apiKey: env.openaiKey });

    // ── Connect ──
    const pc = new Pinecall({ apiKey: env.apiKey, url: env.url });
    const phone = await pickPhone(pc);

    const a = pc.agent("cli-agent", {
        voice: preset.voice,
        stt: preset.stt,
        turnDetection: preset.turnDetection,
    });

    a.addChannel("phone", phone);

    // ── LLM context (per-call history) ──
    const histories = new Map<string, { role: string; content: string }[]>();

    function getLLMContext(callId: string): LLMContext {
        if (!histories.has(callId)) {
            histories.set(callId, [{ role: "system", content: preset.system }]);
        }
        return {
            openai,
            model: DEFAULT_MODEL,
            history: histories.get(callId)!,
            errorMsg: preset.errorMsg,
        };
    }

    // ── TUI ──
    const tui = createTUI();
    const sidebar = createCallSidebar(tui);

    // Show config in call log
    tui.callLog.log(`{cyan-fg}Phone{/cyan-fg}  ${phone}`);
    tui.callLog.log(`{cyan-fg}Voice{/cyan-fg}  ${preset.voice}`);
    tui.callLog.log(`{cyan-fg}STT{/cyan-fg}    ${typeof preset.stt === "string" ? preset.stt : (preset.stt as any).provider}`);
    tui.callLog.log(`{cyan-fg}Model{/cyan-fg}  ${DEFAULT_MODEL}`);
    tui.callLog.log(`{cyan-fg}Lang{/cyan-fg}   ${lang}`);
    tui.callLog.log("");
    tui.screen.render();

    // ── Events ──
    attachTUIEvents(a, sidebar, (turn, call) => {
        const ctx = getLLMContext(call.id);
        streamLLMReplyWithTUI(call, turn, ctx, sidebar);
    });

    a.on("call.started", (call) => {
        call.say(preset.greeting);
    });

    a.on("call.ended", (call) => {
        histories.delete(call.id);
    });

    // ── Connect & run ──
    await pc.connect();

    setupCommandPalette({
        tui,
        sidebar,
        agent: a,
        pc,
    });
}
