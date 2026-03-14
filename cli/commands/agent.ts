/**
 * pinecall agent — inbound voice agent command.
 *
 * Thin orchestrator: parse args → resolve env → build agent → connect → log.
 */

import { Pinecall } from "@pinecall/sdk";
import OpenAI from "openai";
import { parseArgs } from "../lib/args.js";
import { resolveEnv, requireOpenAI } from "../lib/env.js";
import { getPreset } from "../lib/presets.js";
import { DEFAULT_MODEL } from "../lib/constants.js";
import { pickPhone } from "../lib/phone-picker.js";
import { attachEvents, streamLLMReply, type LLMContext } from "../ui/events.js";
import { printHeader, printConfig, ensureCursor } from "../ui/renderer.js";
import { startInput } from "../ui/input.js";

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

    // ── Show header ──
    printHeader("Agent");
    printConfig({
        phone,
        voice: preset.voice,
        stt: typeof preset.stt === "string" ? preset.stt : (preset.stt as any).provider,
        turnDetection: typeof preset.turnDetection === "string" ? preset.turnDetection : "smart",
        model: DEFAULT_MODEL,
        lang,
    });

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

    // ── Events (single log stream) ──
    attachEvents(a, (turn, call) => {
        const ctx = getLLMContext(call.id);
        streamLLMReply(call, turn, ctx);
    });

    a.on("call.started", (call) => {
        call.say(preset.greeting);
    });

    a.on("call.ended", (call) => {
        histories.delete(call.id);
    });

    // ── Connect & run ──
    await pc.connect();

    // ── Input handler ──
    startInput({ agent: a, pc });
    ensureCursor();
}
