/**
 * pinecall dial — outbound call command.
 *
 * Thin orchestrator: parse args → resolve env → build agent → dial → connect.
 */

import { Pinecall } from "@pinecall/sdk";
import OpenAI from "openai";
import { parseArgs } from "../lib/args.js";
import { resolveEnv, requireOpenAI } from "../lib/env.js";
import { getPreset } from "../lib/presets.js";
import { DEFAULT_MODEL } from "../lib/constants.js";
import { pickPhone } from "../lib/phone-picker.js";
import { CliError } from "../lib/errors.js";
import { attachEvents, streamLLMReply, type LLMContext } from "../ui/events.js";
import { printHeader, printConfig, ensureCursor } from "../ui/renderer.js";
import { startInput } from "../ui/input.js";

export default async function dial(argv: string[]): Promise<void> {
    // ── Parse args ──
    const args = parseArgs(argv, {
        flags: ["--es"],
        values: ["--lang", "--from"],
        positional: "to",
    });

    const to = args.positional;
    if (!to) {
        throw new CliError("Usage: pinecall dial <number> [--from=<number>] [--es]");
    }

    const lang = args.values.get("--lang") ?? (args.flags.has("--es") ? "es" : "en");
    const preset = getPreset(lang);

    // ── Env ──
    const env = resolveEnv();
    requireOpenAI(env);
    const openai = new OpenAI({ apiKey: env.openaiKey });

    // ── Connect ──
    const pc = new Pinecall({ apiKey: env.apiKey, url: env.url });
    const from = args.values.get("--from") ?? await pickPhone(pc);

    const a = pc.agent("cli-dialer", {
        voice: preset.voice,
        stt: preset.stt,
        turnDetection: preset.turnDetection,
    });

    a.addChannel("phone", from);

    // ── Show header ──
    printHeader("Dial");
    printConfig({
        phone: `${from} → ${to}`,
        voice: preset.voice,
        stt: typeof preset.stt === "string" ? preset.stt : (preset.stt as any).provider,
        turnDetection: typeof preset.turnDetection === "string" ? preset.turnDetection : "smart",
        model: DEFAULT_MODEL,
        lang,
    });

    // ── LLM context ──
    const history: { role: string; content: string }[] = [
        { role: "system", content: preset.system },
    ];

    const llmCtx: LLMContext = {
        openai,
        model: DEFAULT_MODEL,
        history,
        errorMsg: preset.errorMsg,
    };

    // ── Events ──
    attachEvents(a, (turn, call) => {
        streamLLMReply(call, turn, llmCtx);
    });

    a.on("call.ended", async () => {
        await pc.disconnect();
        process.exit(0);
    });

    // ── Connect & dial ──
    await pc.connect();
    await a.dial({ to, from, greeting: preset.greeting });

    // ── Input handler ──
    startInput({ agent: a, pc });
    ensureCursor();
}
