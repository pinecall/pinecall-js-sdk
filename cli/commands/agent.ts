/**
 * pinecall agent — inbound voice agent command.
 *
 * Thin orchestrator: parse args → resolve env → build agent → attach handlers → connect.
 */

import { Pinecall } from "@pinecall/sdk";
import OpenAI from "openai";
import { parseArgs } from "../lib/args.js";
import { resolveEnv, requireOpenAI } from "../lib/env.js";
import { getPreset } from "../lib/presets.js";
import { DEFAULT_MODEL } from "../lib/constants.js";
import { pickPhone } from "../lib/phone-picker.js";
import { streamLLMReply, type LLMContext } from "../lib/llm.js";
import { printHeader, printConfig, printStatus, logLine } from "../ui/renderer.js";
import { attachEvents } from "../ui/events.js";
import { startInput } from "../ui/input.js";
import { MUTED, DIM } from "../ui/theme.js";

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

    let currentInstructions = preset.system;

    function setInstructions(newInstructions: string): void {
        currentInstructions = newInstructions;
        // Update system prompt in all existing histories
        for (const hist of histories.values()) {
            if (hist[0]?.role === "system") {
                hist[0].content = newInstructions;
            }
        }
    }

    // ── Events ──
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
    printHeader("Voice Agent");
    await pc.connect();

    printConfig({
        phone,
        voice: preset.voice,
        stt: typeof preset.stt === "string" ? preset.stt : (preset.stt as any).provider,
        turnDetection: typeof preset.turnDetection === "string" ? preset.turnDetection : "custom",
        model: DEFAULT_MODEL,
        lang,
    });

    printStatus("Agent is live", "waiting for calls…");

    startInput({
        agent: a,
        pc,
        instructions: currentInstructions,
        onInstructionsChange: setInstructions,
    });
}
