/**
 * pinecall dial — outbound call command.
 *
 * Thin orchestrator: parse args → resolve env → build agent → dial → attach handlers → connect.
 */

import { Pinecall } from "@pinecall/sdk";
import OpenAI from "openai";
import { parseArgs } from "../lib/args.js";
import { resolveEnv, requireOpenAI } from "../lib/env.js";
import { getPreset } from "../lib/presets.js";
import { DEFAULT_MODEL } from "../lib/constants.js";
import { pickPhone } from "../lib/phone-picker.js";
import { streamLLMReply, type LLMContext } from "../lib/llm.js";
import { CliError } from "../lib/errors.js";
import { printHeader, printConfig, printStatus, logLine, writeln } from "../ui/renderer.js";
import { attachEvents } from "../ui/events.js";
import { startInput } from "../ui/input.js";
import { ACCENT, DIM, MUTED } from "../ui/theme.js";

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

    // ── LLM context ──
    const history: { role: string; content: string }[] = [
        { role: "system", content: preset.system },
    ];

    let currentInstructions = preset.system;

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
        writeln("");
        printStatus("Call ended");
        await pc.disconnect();
        process.exit(0);
    });

    // ── Connect & dial ──
    printHeader("Outbound Call");
    await pc.connect();

    printConfig({
        phone: from,
        voice: preset.voice,
        stt: typeof preset.stt === "string" ? preset.stt : (preset.stt as any).provider,
        turnDetection: typeof preset.turnDetection === "string" ? preset.turnDetection : "custom",
        model: DEFAULT_MODEL,
        lang,
    });

    printStatus("Dialing", ACCENT(to));
    const call = await a.dial({ to, from, greeting: preset.greeting });
    printStatus("Connected", DIM(call.id.slice(0, 12)));

    startInput({
        agent: a,
        pc,
        instructions: currentInstructions,
        onInstructionsChange: (newInstructions: string) => {
            currentInstructions = newInstructions;
            if (history[0]?.role === "system") {
                history[0].content = newInstructions;
            }
        },
    });
}
